import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="flex items-center gap-5">
        <div className="text-2xl">404</div>
        <div>
          <h2>Not Found</h2>
          <p>Could not find requested resource</p>
          <Link href="/" className="underline">
            Return Home
          </Link>
        </div>
      </div>
    </div>
  );
}
