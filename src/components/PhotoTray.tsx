"use client";

import { useRef } from "react";
import { MAX_PHOTOS } from "@/lib/uploads-client";

export function PhotoTray({
  photos,
  onRemove,
  onAdd,
  locked = false,
}: {
  photos: string[];
  onRemove: (src: string) => void;
  onAdd: (files: File[]) => void;
  locked?: boolean;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const remaining = Math.max(0, MAX_PHOTOS - photos.length);

  function take(list: FileList | null) {
    if (locked || !list || remaining === 0) return;
    onAdd(Array.from(list).slice(0, remaining));
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  }

  return (
    <div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => take(e.target.files)}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => take(e.target.files)}
      />

      {photos.length === 0 ? (
        <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl bg-ink px-5 py-8 text-paper">
          <p className="font-serif text-2xl">Add photos</p>
          <p className="mt-1 text-center text-sm text-paper/60">
            Up to {MAX_PHOTOS}. Camera or camera roll.
          </p>
          <AddPhotoButtons
            onCamera={() => cameraRef.current?.click()}
            onRoll={() => libraryRef.current?.click()}
            dark
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {photos.map((src) => (
              <div key={src} className="relative overflow-hidden rounded-2xl bg-wash">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-36 w-full object-cover" />
                {!locked && (
                  <button
                    type="button"
                    onClick={() => onRemove(src)}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/80 text-paper"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {locked ? null : remaining > 0 ? (
            <div className="mt-3 rounded-2xl border border-dashed border-ink/25 bg-card px-4 py-4">
              <p className="font-serif text-xl leading-tight">Add more photos</p>
              <p className="mt-1 text-sm text-ink/60">
                Use the camera or camera roll for another angle. {photos.length} of {MAX_PHOTOS}.
              </p>
              <AddPhotoButtons
                onCamera={() => cameraRef.current?.click()}
                onRoll={() => libraryRef.current?.click()}
              />
            </div>
          ) : (
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-ink/45">
              {MAX_PHOTOS} of {MAX_PHOTOS} photos
            </p>
          )}
        </>
      )}
    </div>
  );
}

function AddPhotoButtons({
  onCamera,
  onRoll,
  dark,
}: {
  onCamera: () => void;
  onRoll: () => void;
  dark?: boolean;
}) {
  return (
    <div className={`flex w-full flex-col gap-2 ${dark ? "mt-5" : "mt-4"}`}>
      <button
        type="button"
        onClick={onCamera}
        className="h-12 w-full shrink-0 rounded-full bg-sold px-4 text-sm text-paper"
      >
        Camera
      </button>
      <button
        type="button"
        onClick={onRoll}
        className={
          dark
            ? "h-12 w-full shrink-0 rounded-full bg-paper px-4 text-sm text-ink"
            : "h-12 w-full shrink-0 rounded-full border border-line bg-paper px-4 text-sm"
        }
      >
        Camera roll
      </button>
    </div>
  );
}
