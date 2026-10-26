import { useEffect, useState } from "react";

// true — только если on держится дольше ms. Скелетон не мигает на ответах
// из кэша, которые приходят быстрее задержки (TASK-0005, решение человека: 300 мс)
export const useDelayedFlag = (on: boolean, ms: number): boolean => {
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    if (!on) return;
    const timer = setTimeout(() => setElapsed(true), ms);
    // Сброс — в очистке: on погас (или сменилась задержка) — следующий
    // показ снова ждёт полный срок
    return () => {
      clearTimeout(timer);
      setElapsed(false);
    };
  }, [on, ms]);

  return on && elapsed;
};
