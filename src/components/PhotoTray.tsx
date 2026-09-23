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
        <div className="flex min-h-56 flex-col justify-end rounded-2xl border border-line bg-wash px-5 py-5">
          <p className="display text-[1.5rem] tracking-tight">Add photos</p>
          <p className="mt-1 text-[13px] text-grey">
            Up to {MAX_PHOTOS}. Camera or camera roll.
          </p>
          <AddPhotoButtons
            onCamera={() => cameraRef.current?.click()}
            onRoll={() => libraryRef.current?.click()}
          />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2.5">
            {photos.map((src) => (
              <div key={src} className="relative overflow-hidden rounded-xl bg-wash">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-36 w-full object-cover" />
                {!locked && (
                  <button
                    type="button"
                    onClick={() => onRemove(src)}
                    className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink/85 text-sm text-paper"
                    aria-label="Remove photo"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {locked ? null : remaining > 0 ? (
            <div className="panel mt-3 px-4 py-4">
              <p className="text-[15px] font-semibold tracking-tight text-ink">
                Add more photos
              </p>
              <p className="mt-1 text-[13px] text-grey">
                Another angle helps identification. {photos.length} of {MAX_PHOTOS}.
              </p>
              <AddPhotoButtons
                onCamera={() => cameraRef.current?.click()}
                onRoll={() => libraryRef.current?.click()}
              />
            </div>
          ) : (
            <p className="mt-2 text-[12px] text-grey">
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
}: {
  onCamera: () => void;
  onRoll: () => void;
}) {
  return (
    <div className="mt-4 flex w-full flex-col gap-2">
      <button type="button" onClick={onCamera} className="btn-primary w-full">
        Take a photo
      </button>
      <button type="button" onClick={onRoll} className="btn-secondary w-full">
        Choose from camera roll
      </button>
    </div>
  );
}
