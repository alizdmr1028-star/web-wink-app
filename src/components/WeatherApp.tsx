import { useEffect, useRef, useState } from "react";

type Props = {
  onEquals: (pin: string) => Promise<boolean>;
};

type Current = {
  temp: number;
  code: number;
  humidity: number;
  wind: number;
  feels: number;
};

type Day = { date: string; code: number; max: number; min: number };

type Place = { name: string; country: string; lat: number; lon: number };

const DEFAULT_PLACE: Place = { name: "İstanbul", country: "Türkiye", lat: 41.0138, lon: 28.9497 };

function describe(code: number) {
  if (code === 0) return "Açık";
  if ([1, 2].includes(code)) return "Parçalı bulutlu";
  if (code === 3) return "Bulutlu";
  if ([45, 48].includes(code)) return "Sisli";
  if ([51, 53, 55, 56, 57].includes(code)) return "Çisenti";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Yağmurlu";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "Karlı";
  if ([95, 96, 99].includes(code)) return "Gök gürültülü";
  return "Değişken";
}

function icon(code: number) {
  if (code === 0) return "☀️";
  if ([1, 2].includes(code)) return "⛅️";
  if (code === 3) return "☁️";
  if ([45, 48].includes(code)) return "🌫️";
  if ([51, 53, 55, 56, 57].includes(code)) return "🌦️";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "🌧️";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "❄️";
  if ([95, 96, 99].includes(code)) return "⛈️";
  return "🌤️";
}

const dayNames = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];

export default function WeatherApp({ onEquals }: Props) {
  const [place, setPlace] = useState<Place>(DEFAULT_PLACE);
  const [current, setCurrent] = useState<Current | null>(null);
  const [days, setDays] = useState<Day[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pinSheet, setPinSheet] = useState(false);
  const [pin, setPin] = useState("");
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
      `&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7`;
    fetch(url)
      .then((r) => r.json())
      .then((d: {
        current?: Record<string, number>;
        daily?: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
      }) => {
        if (!alive) return;
        if (d.current) {
          setCurrent({
            temp: Math.round(d.current["temperature_2m"] ?? 0),
            code: d.current["weather_code"] ?? 0,
            humidity: Math.round(d.current["relative_humidity_2m"] ?? 0),
            wind: Math.round(d.current["wind_speed_10m"] ?? 0),
            feels: Math.round(d.current["apparent_temperature"] ?? 0),
          });
        }
        if (d.daily) {
          setDays(
            d.daily.time.map((t, i) => ({
              date: t,
              code: d.daily!.weather_code[i] ?? 0,
              max: Math.round(d.daily!.temperature_2m_max[i] ?? 0),
              min: Math.round(d.daily!.temperature_2m_min[i] ?? 0),
            })),
          );
        }
      })
      .catch(() => {
        /* sessizce yoksay */
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [place]);

  async function searchCity(name: string) {
    try {
      const res = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=tr&format=json`,
      );
      const data = (await res.json()) as {
        results?: { name: string; country?: string; latitude: number; longitude: number }[];
      };
      const hit = data.results?.[0];
      if (hit) {
        setPlace({ name: hit.name, country: hit.country ?? "", lat: hit.latitude, lon: hit.longitude });
      }
    } catch {
      /* sessizce yoksay */
    }
  }

  async function submitSearch() {
    const raw = query.trim();
    if (!raw) return;
    const digits = raw.replace(/[^0-9]/g, "");
    if (digits.length >= 4 && digits === raw) {
      const unlocked = await onEquals(digits);
      if (unlocked) return;
      setQuery("");
      return;
    }
    setQuery("");
    await searchCity(raw);
  }

  async function submitPin() {
    const digits = pin.replace(/[^0-9]/g, "");
    setPin("");
    if (digits.length < 4) {
      setPinSheet(false);
      return;
    }
    const unlocked = await onEquals(digits);
    if (!unlocked) setPinSheet(false);
  }

  function startPress() {
    pressTimer.current = setTimeout(() => setPinSheet(true), 3000);
  }
  function endPress() {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  }

  return (
    <div className="min-h-dvh bg-gradient-to-b from-[#2b5876] to-[#4e4376] px-5 pb-10 text-white safe-top safe-bottom">
      <header className="flex items-center justify-between pt-4">
        <h1 className="text-[15px] font-semibold tracking-wide opacity-90">Hava Durumu</h1>
        <button
          aria-label="Hava durumu"
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onContextMenu={(e) => e.preventDefault()}
          className="select-none text-[26px] leading-none"
        >
          {icon(current?.code ?? 0)}
        </button>
      </header>

      <div className="mt-4 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submitSearch();
          }}
          placeholder="Şehir ara"
          autoCapitalize="words"
          className="flex-1 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-[16px] text-white placeholder:text-white/60 outline-none"
        />
        <button
          onClick={() => void submitSearch()}
          className="rounded-2xl bg-white/20 px-5 text-[15px] font-semibold active:opacity-70"
        >
          Ara
        </button>
      </div>

      <section className="mt-10 text-center">
        <p className="text-[17px] opacity-90">
          {place.name}
          {place.country ? `, ${place.country}` : ""}
        </p>
        <div className="mt-2 text-[84px] leading-none font-extralight tabular-nums">
          {loading || !current ? "—" : `${current.temp}°`}
        </div>
        <p className="mt-1 text-[17px] opacity-90">
          {icon(current?.code ?? 0)} {describe(current?.code ?? 0)}
        </p>
        {current && (
          <p className="mt-1 text-[13px] opacity-70">
            Hissedilen {current.feels}° · Nem %{current.humidity} · Rüzgâr {current.wind} km/s
          </p>
        )}
      </section>

      <section className="mt-10 rounded-3xl bg-white/10 p-4">
        <h2 className="px-1 pb-2 text-[12px] uppercase tracking-wider opacity-70">7 günlük tahmin</h2>
        <ul>
          {days.map((d) => (
            <li key={d.date} className="flex items-center justify-between border-t border-white/10 py-2.5 first:border-0">
              <span className="w-14 text-[15px]">{dayNames[new Date(d.date).getDay()]}</span>
              <span className="text-[20px]">{icon(d.code)}</span>
              <span className="w-24 text-right text-[15px] tabular-nums">
                <span className="opacity-60">{d.min}°</span> {d.max}°
              </span>
            </li>
          ))}
        </ul>
      </section>

      {pinSheet && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-4" onClick={() => setPinSheet(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full rounded-3xl bg-[#1c1c1e] p-5 safe-bottom"
          >
            <p className="text-[13px] text-[#8e8e93]">Konum servisi kodu</p>
            <input
              autoFocus
              value={pin}
              inputMode="numeric"
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitPin();
              }}
              className="mt-3 w-full rounded-2xl border border-[#333] bg-[#2c2c2e] px-4 py-3.5 text-[16px] tracking-[0.4em] text-white outline-none"
            />
            <button
              onClick={() => void submitPin()}
              className="mt-3 w-full rounded-2xl bg-[#0A84FF] py-3.5 text-[16px] font-semibold text-white"
            >
              Onayla
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
