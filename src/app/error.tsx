'use client';

interface ErrorProps {
  error: Error;
  reset: () => void;
}

export default function Error(props: ErrorProps) {
  const { error, reset } = props;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center space-y-4">
      <div className="flex gap-2">
        <div>Something went wrong</div>
        <div className="cursor-pointer underline" onClick={reset}>
          back
        </div>
      </div>
      <div className="w-3/4 overflow-auto rounded-sm bg-slate-50 p-5 font-bold text-red-400">
        <div>{error.message}</div>
        <div>{error.stack}</div>
      </div>
    </div>
  );
}
