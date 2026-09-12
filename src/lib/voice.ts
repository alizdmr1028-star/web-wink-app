import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Free public relay (TURN). All audio is routed through the relay so the two
// devices never learn each other's IP address. WebRTC media itself is always
// encrypted end to end with DTLS-SRTP.
const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      "turn:openrelay.metered.ca:80",
      "turn:openrelay.metered.ca:443",
      "turns:openrelay.metered.ca:443?transport=tcp",
    ],
    username: "openrelayproject",
    credential: "openrelayproject",
  },
];

export type CallState = "idle" | "calling" | "incoming" | "connected";

type Signal =
  | { kind: "offer"; from: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; candidate: RTCIceCandidateInit }
  | { kind: "end"; from: string };

export function useVoiceCall(userId: string, conversationId: string | null) {
  const [state, setState] = useState<CallState>("idle");
  const [error, setError] = useState<string | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingOffer = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingIce = useRef<RTCIceCandidateInit[]>([]);
  const relaySeen = useRef(false);
  const watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback((payload: Signal) => {
    void channelRef.current?.send({ type: "broadcast", event: "signal", payload });
  }, []);

  const cleanup = useCallback(() => {
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    pcRef.current = null;
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.remove();
      audioRef.current = null;
    }
    pendingOffer.current = null;
    pendingIce.current = [];
    relaySeen.current = false;
    if (watchdog.current) {
      clearTimeout(watchdog.current);
      watchdog.current = null;
    }
    setState("idle");
  }, []);

  const hangup = useCallback(() => {
    send({ kind: "end", from: userId });
    cleanup();
  }, [send, cleanup, userId]);

  const createPeer = useCallback(async () => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceTransportPolicy: "relay" });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    localRef.current = stream;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ kind: "ice", from: userId, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      let el = audioRef.current;
      if (!el) {
        el = document.createElement("audio");
        el.autoplay = true;
        document.body.appendChild(el);
        audioRef.current = el;
      }
      el.srcObject = e.streams[0] ?? null;
      void el.play().catch(() => undefined);
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") setState("connected");
      if (["failed", "disconnected", "closed"].includes(pc.connectionState)) cleanup();
    };
    pcRef.current = pc;
    return pc;
  }, [send, userId, cleanup]);

  const startCall = useCallback(async () => {
    if (!conversationId || state !== "idle") return;
    setError(null);
    try {
      const pc = await createPeer();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      setState("calling");
      send({ kind: "offer", from: userId, sdp: offer });
    } catch {
      setError("Mikrofona erişilemedi");
      cleanup();
    }
  }, [conversationId, state, createPeer, send, userId, cleanup]);

  const accept = useCallback(async () => {
    const offer = pendingOffer.current;
    if (!offer) return;
    try {
      const pc = await createPeer();
      await pc.setRemoteDescription(offer);
      for (const c of pendingIce.current) await pc.addIceCandidate(c);
      pendingIce.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      send({ kind: "answer", from: userId, sdp: answer });
      setState("calling");
    } catch {
      setError("Aramaya bağlanılamadı");
      cleanup();
    }
  }, [createPeer, send, userId, cleanup]);

  const reject = useCallback(() => {
    send({ kind: "end", from: userId });
    cleanup();
  }, [send, userId, cleanup]);

  // signaling channel per conversation
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase.channel(`call:${conversationId}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "signal" }, async ({ payload }) => {
      const sig = payload as Signal;
      if (sig.from === userId) return;
      if (sig.kind === "offer") {
        if (pcRef.current) return;
        pendingOffer.current = sig.sdp;
        setState("incoming");
      } else if (sig.kind === "answer") {
        const pc = pcRef.current;
        if (!pc) return;
        await pc.setRemoteDescription(sig.sdp);
        for (const c of pendingIce.current) await pc.addIceCandidate(c);
        pendingIce.current = [];
      } else if (sig.kind === "ice") {
        if (pcRef.current?.remoteDescription) await pcRef.current.addIceCandidate(sig.candidate);
        else pendingIce.current.push(sig.candidate);
      } else {
        cleanup();
      }
    });
    channel.subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      void supabase.removeChannel(channel);
      cleanup();
    };
  }, [conversationId, userId, cleanup]);

  // security: end the call as soon as the app goes to the background
  useEffect(() => {
    if (state === "idle") return;
    const onHide = () => {
      if (document.visibilityState === "hidden") hangup();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", hangup);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", hangup);
    };
  }, [state, hangup]);

  return { state, error, startCall, accept, reject, hangup };
}
