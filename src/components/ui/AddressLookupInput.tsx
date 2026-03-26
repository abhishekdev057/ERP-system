"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, MapPin } from "lucide-react";

export type AddressSuggestion = {
    label: string;
    name?: string;
    village?: string;
    city?: string;
    district?: string;
    state?: string;
    country?: string;
    postcode?: string;
    latitude?: number;
    longitude?: number;
};

type AddressLookupInputProps = {
    value: string;
    onChange: (value: string) => void;
    onSelectSuggestion?: (suggestion: AddressSuggestion) => void;
    placeholder?: string;
    className?: string;
    inputClassName?: string;
    panelClassName?: string;
    helperText?: string;
};

function formatParts(suggestion: AddressSuggestion) {
    return [
        suggestion.village ? `Village ${suggestion.village}` : "",
        suggestion.city ? `City ${suggestion.city}` : "",
        suggestion.district ? `District ${suggestion.district}` : "",
        suggestion.state ? `State ${suggestion.state}` : "",
    ].filter(Boolean);
}

export function AddressLookupInput({
    value,
    onChange,
    onSelectSuggestion,
    placeholder,
    className,
    inputClassName,
    panelClassName,
    helperText,
}: AddressLookupInputProps) {
    const [query, setQuery] = useState(value);
    const [loading, setLoading] = useState(false);
    const [open, setOpen] = useState(false);
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [activeSuggestion, setActiveSuggestion] = useState<AddressSuggestion | null>(null);
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        setQuery(value);
    }, [value]);

    useEffect(() => {
        const onClickOutside = (event: MouseEvent) => {
            if (!wrapperRef.current) return;
            if (!wrapperRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        };

        window.addEventListener("mousedown", onClickOutside);
        return () => window.removeEventListener("mousedown", onClickOutside);
    }, []);

    useEffect(() => {
        const trimmed = query.trim();
        if (trimmed.length < 3) {
            setSuggestions([]);
            setLoading(false);
            return;
        }

        const controller = new AbortController();
        const timer = window.setTimeout(async () => {
            setLoading(true);
            try {
                const response = await fetch(`/api/address-suggestions?q=${encodeURIComponent(trimmed)}`, {
                    signal: controller.signal,
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.error || "Failed to load address suggestions.");
                }
                setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
            } catch (error: any) {
                if (error.name === "AbortError") return;
                setSuggestions([]);
            } finally {
                setLoading(false);
            }
        }, 320);

        return () => {
            controller.abort();
            window.clearTimeout(timer);
        };
    }, [query]);

    const hintParts = useMemo(
        () => (activeSuggestion ? formatParts(activeSuggestion) : []),
        [activeSuggestion]
    );

    return (
        <div ref={wrapperRef} className={className}>
            <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                    value={query}
                    onFocus={() => setOpen(true)}
                    onChange={(event) => {
                        const nextValue = event.target.value;
                        setQuery(nextValue);
                        setActiveSuggestion(null);
                        onChange(nextValue);
                        setOpen(true);
                    }}
                    placeholder={placeholder}
                    className={inputClassName}
                />
                {loading ? (
                    <LoaderCircle className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                ) : null}
            </div>

            {helperText ? <p className="mt-2 text-[11px] text-slate-500">{helperText}</p> : null}

            {hintParts.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                    {hintParts.map((part) => (
                        <span
                            key={part}
                            className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold text-slate-600"
                        >
                            {part}
                        </span>
                    ))}
                </div>
            ) : null}

            {open && suggestions.length ? (
                <div className={panelClassName}>
                    {suggestions.map((suggestion) => {
                        const parts = formatParts(suggestion);
                        return (
                            <button
                                key={suggestion.label}
                                type="button"
                                onClick={() => {
                                    setQuery(suggestion.label);
                                    setActiveSuggestion(suggestion);
                                    setOpen(false);
                                    onChange(suggestion.label);
                                    onSelectSuggestion?.(suggestion);
                                }}
                                className="w-full rounded-2xl border border-transparent bg-white/90 px-3 py-3 text-left transition hover:border-sky-200 hover:bg-sky-50"
                            >
                                <p className="text-sm font-semibold text-slate-900">{suggestion.label}</p>
                                {parts.length ? (
                                    <p className="mt-1 text-[11px] text-slate-500">{parts.join(" · ")}</p>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
