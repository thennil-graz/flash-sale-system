import { useState, useEffect } from 'react';
import { SalePhase } from '../types/sale';


interface CountdownResult {
  phase: SalePhase;
  timeLeft: { days: number; hours: number; minutes: number; seconds: number };
}

export function useCountdown(startTime: Date, endTime: Date): CountdownResult {
  const getPhase = (): SalePhase => {
    const now = Date.now();
    if (now < startTime.getTime()) return 'upcoming';
    if (now < endTime.getTime()) return 'ongoing';
    return 'ended';
  };

  const getTimeLeft = (target: Date) => {
    const diff = Math.max(0, target.getTime() - Date.now());
    const totalSecs = Math.floor(diff / 1000);
    return {
      days:    Math.floor(totalSecs / 86400),
      hours:   Math.floor((totalSecs % 86400) / 3600),
      minutes: Math.floor((totalSecs % 3600) / 60),
      seconds: totalSecs % 60,
    };
  };

  const [phase, setPhase] = useState<SalePhase>(getPhase);
  const [timeLeft, setTimeLeft] = useState(() =>
    getTimeLeft(phase === 'upcoming' ? startTime : endTime)
  );

  useEffect(() => {
    const tick = () => {
      const currentPhase = getPhase();
      setPhase(currentPhase);
      setTimeLeft(getTimeLeft(currentPhase === 'upcoming' ? startTime : endTime));
    };

    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime, endTime]);

  return { phase, timeLeft };
}
