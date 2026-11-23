import { forwardRef, useEffect, useRef, useState, type ImgHTMLAttributes } from "react";
import { isProtectedMediaSource, useProtectedObjectUrl } from "@/lib/protected-media";

type ProtectedImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & { src: string };

export const ProtectedImage = forwardRef<HTMLImageElement, ProtectedImageProps>(
  function ProtectedImage({ src, alt, loading, ...props }, ref) {
    const image = useRef<HTMLImageElement | null>(null);
    const protectedSource = isProtectedMediaSource(src);
    const [visible, setVisible] = useState(loading !== "lazy");
    const { url, error } = useProtectedObjectUrl(protectedSource && visible ? src : null);

    useEffect(() => {
      if (!protectedSource || visible) return;
      if (loading !== "lazy") { setVisible(true); return; }
      if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) setVisible(true);
      });
      if (image.current) observer.observe(image.current);
      return () => observer.disconnect();
    }, [loading, protectedSource, visible]);

    useEffect(() => {
      // Existing image-error fallbacks retain their usual DOM event semantics.
      if (error && props.onError) image.current?.dispatchEvent(new Event("error"));
    }, [error, props.onError]);

    return (
      <>
        <img
          {...props}
          ref={node => {
            image.current = node;
            if (typeof ref === "function") ref(node);
            else if (ref) ref.current = node;
          }}
          src={protectedSource ? url || undefined : src}
          alt={alt}
          loading={loading}
        />
        {error && !props.onError && <span role="alert">{error.message}</span>}
      </>
    );
  },
);
