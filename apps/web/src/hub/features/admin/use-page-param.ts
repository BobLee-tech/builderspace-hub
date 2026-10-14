import { useRouter } from "next/router";

/**
 * A positive integer kept in the URL (`?page=2`), so a refresh or a shared link
 * shows the same page of a list.
 */
export function usePageParam(name = "page"): [number, (next: number) => void] {
  const router = useRouter();
  const raw = Number(router.query[name]);
  const value = Number.isInteger(raw) && raw > 0 ? raw : 1;

  const setValue = (next: number) => {
    void router.push(
      {
        pathname: router.pathname,
        query: { ...router.query, [name]: String(next) },
      },
      undefined,
      { shallow: true },
    );
  };

  return [value, setValue];
}
