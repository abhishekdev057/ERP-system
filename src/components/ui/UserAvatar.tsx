"use client";

import { useMemo, useState } from "react";

type UserAvatarProps = {
    src?: string | null;
    name?: string | null;
    email?: string | null;
    alt?: string;
    sizeClass?: string;
    className?: string;
    textClassName?: string;
};

function normalizeImageSrc(src?: string | null): string | null {
    if (!src) return null;
    const value = String(src).trim();
    if (!value || value === "null" || value === "undefined") return null;
    return value;
}

function getInitial(name?: string | null, email?: string | null): string {
    const source = (name || email || "U").trim();
    return source ? source[0].toUpperCase() : "U";
}

export default function UserAvatar({
    src,
    name,
    email,
    alt,
    sizeClass = "w-9 h-9",
    className = "",
    textClassName = "text-sm",
}: UserAvatarProps) {
    const [hasError, setHasError] = useState(false);
    const normalizedSrc = useMemo(() => normalizeImageSrc(src), [src]);
    const showImage = Boolean(normalizedSrc) && !hasError;
    const initial = useMemo(() => getInitial(name, email), [name, email]);

    if (!showImage) {
        return (
            <div
                className={`${sizeClass} rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold ${textClassName} ${className}`.trim()}
                aria-label={alt || "User avatar"}
            >
                {initial}
            </div>
        );
    }

    return (
        <img
            src={normalizedSrc!}
            alt={alt || "User avatar"}
            className={`${sizeClass} rounded-full object-cover ${className}`.trim()}
            referrerPolicy="no-referrer"
            onError={() => setHasError(true)}
        />
    );
}
