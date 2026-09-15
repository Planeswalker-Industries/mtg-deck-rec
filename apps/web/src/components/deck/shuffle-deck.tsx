"use client";

import { motion, useReducedMotion } from "motion/react";
import { cn } from "cn";
import { CardBack } from "./card-back";

const CARDS = 5;

/**
 * A small stack of sleeved cards shuffling while the database is working: alternate cards split left and right and
 * settle back. It shows only as long as the work takes; with reduced motion it's a still, fanned stack.
 */
export function ShuffleDeck({ label, id, className }: { label: string; id?: string; className?: string }) {
  const reduceMotion = useReducedMotion();

  return (
    <div id={id} role="status" aria-label={label} className={cn("flex flex-col items-center gap-4 py-10", className)}>
      <div className="relative w-28">
        {Array.from({ length: CARDS }, (_, i) => {
          const side = i % 2 === 0 ? -1 : 1;
          const rest = { x: i * 2, y: -i * 2, rotate: (i - 2) * 1.5 };
          return (
            <motion.div
              key={i}
              className={cn(i > 0 && "absolute inset-0")}
              style={{ zIndex: CARDS - i }}
              initial={rest}
              animate={
                reduceMotion
                  ? rest
                  : {
                      x: [rest.x, side * (40 + i * 4), rest.x],
                      y: [rest.y, -16 - i * 3, rest.y],
                      rotate: [rest.rotate, side * 10, rest.rotate],
                    }
              }
              transition={
                reduceMotion ? { duration: 0 } : { duration: 1.1, ease: "easeInOut", repeat: Infinity, delay: i * 0.07, times: [0, 0.45, 1] }
              }
            >
              <CardBack sizes="112px" eager />
            </motion.div>
          );
        })}
      </div>
      <p className="text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
