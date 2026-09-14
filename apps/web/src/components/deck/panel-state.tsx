import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export function PanelLoading({ label = "Loading cards" }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="grid grid-cols-3 gap-x-2 gap-y-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="p-1">
          <Skeleton className="aspect-[488/680] w-full rounded-[4.75%/3.4%] bg-seam" />
          <Skeleton className="mt-2 h-3 w-3/4 bg-seam" />
        </div>
      ))}
    </div>
  );
}

export function PanelError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Couldn&apos;t load these cards</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}
