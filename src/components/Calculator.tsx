import { useState } from "react";

type Props = {
  onEquals: (display: string) => Promise<boolean>;
  hint?: string | null;
};

const KEYS = [
  ["AC", "+/-", "%", "÷"],
  ["7", "8", "9", "×"],
  ["4", "5", "6", "−"],
  ["1", "2", "3", "+"],
  ["0", ",", "="],
];

export default function Calculator({ onEquals, hint }: Props) {
  const [display, setDisplay] = useState("0");
  const [acc, setAcc] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);

  function inputDigit(d: string) {
    setDisplay((cur) => (fresh || cur === "0" ? d : cur + d));
    setFresh(false);
  }

  function compute(a: number, b: number, operator: string) {
    switch (operator) {
      case "+":
        return a + b;
      case "−":
        return a - b;
      case "×":
        return a * b;
      case "÷":
        return b === 0 ? 0 : a / b;
      default:
        return b;
    }
  }

  function format(n: number) {
    if (!isFinite(n)) return "0";
    return String(Math.round(n * 1e8) / 1e8).replace(".", ",");
  }

  async function press(k: string) {
    if (/^[0-9]$/.test(k)) return inputDigit(k);
    if (k === ",") {
      if (!display.includes(",")) setDisplay(display + ",");
      setFresh(false);
      return;
    }
    if (k === "AC") {
      setDisplay("0");
      setAcc(null);
      setOp(null);
      setFresh(true);
      return;
    }
    if (k === "+/-") {
      setDisplay(display.startsWith("-") ? display.slice(1) : display === "0" ? "0" : "-" + display);
      return;
    }
    if (k === "%") {
      setDisplay(format(parseFloat(display.replace(",", ".")) / 100));
      return;
    }
    if (["+", "−", "×", "÷"].includes(k)) {
      const value = parseFloat(display.replace(",", "."));
      setAcc(acc !== null && op ? compute(acc, value, op) : value);
      setDisplay(acc !== null && op ? format(compute(acc, value, op)) : display);
      setOp(k);
      setFresh(true);
      return;
    }
    if (k === "=") {
      const secret = display.replace(/[^0-9]/g, "");
      if (secret.length >= 4 && acc === null) {
        const unlocked = await onEquals(secret);
        if (unlocked) return;
      }
      const value = parseFloat(display.replace(",", "."));
      const result = acc !== null && op ? compute(acc, value, op) : value;
      setDisplay(format(result));
      setAcc(null);
      setOp(null);
      setFresh(true);
    }
  }

  return (
    <div className="flex h-dvh flex-col justify-end bg-black px-3 pb-6 safe-bottom safe-top">
      <div className="px-4 pb-6 text-right text-[76px] font-light leading-none text-white tabular-nums">
        {display}
      </div>
      <div className="space-y-3">
        {KEYS.map((row, ri) => (
          <div key={ri} className="flex gap-3">
            {row.map((k) => {
              const isOp = ["÷", "×", "−", "+", "="].includes(k);
              const isTop = ["AC", "+/-", "%"].includes(k);
              const wide = k === "0";
              return (
                <button
                  key={k}
                  onClick={() => void press(k)}
                  className={`flex h-[74px] items-center justify-center rounded-full text-[30px] font-medium transition-opacity active:opacity-60 ${
                    wide ? "flex-[2.15] justify-start pl-8" : "flex-1"
                  } ${
                    isOp
                      ? "bg-[#FF9F0A] text-white"
                      : isTop
                        ? "bg-[#A5A5A5] text-black"
                        : "bg-[#333333] text-white"
                  }`}
                >
                  {k}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {hint && <p className="pt-4 text-center text-[11px] text-[#3a3a3a]">{hint}</p>}
    </div>
  );
}
