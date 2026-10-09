/** Provider avatar with an initial-letter fallback. */
export default function Avatar({
  name,
  url,
  size = 32,
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size };
  if (url)
    // eslint-disable-next-line @next/next/no-img-element -- remote provider avatars, any host
    return <img src={url} alt="" style={style} className={`shrink-0 object-cover ${className}`} referrerPolicy="no-referrer" />;
  return (
    <span
      style={{ ...style, fontSize: size * 0.5 }}
      className={`display inline-flex shrink-0 items-center justify-center bg-red font-black uppercase text-white ${className}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
