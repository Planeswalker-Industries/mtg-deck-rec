"use client";

import { useEffect } from "react";
import type { TourId } from "@/lib/tours";
import { useTour } from "./tour-provider";

/**
 * Starts a page's tour once the page has hydrated (or queues it behind one already running), and lets it go when the
 * page does. Renders nothing; the steps find their elements by `data-tour`.
 */
export function PageTour({ id }: { id: TourId }): null {
  const { request, release } = useTour();
  useEffect(() => {
    request(id);
    return () => release(id);
  }, [id, request, release]);
  return null;
}
