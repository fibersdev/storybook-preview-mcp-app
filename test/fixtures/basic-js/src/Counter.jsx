import { useState } from "react";

export function Counter({ label = "Clicked" }) {
  const [n, setN] = useState(0);
  return (
    <button className="btn" onClick={() => setN(n + 1)}>
      {label} {n} times
    </button>
  );
}
