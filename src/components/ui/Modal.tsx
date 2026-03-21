"use client";

import { useEffect, useState } from "react";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm?: () => void | Promise<void>;
    title: string;
    message: string;
    type?: "info" | "warning" | "danger" | "success";
    confirmText?: string;
    cancelText?: string;
    theme?: "light" | "dark";
}

export default function Modal({
    isOpen,
    onClose,
    onConfirm,
    title,
    message,
    type = "info",
    confirmText = "Confirm",
    cancelText = "Cancel",
    theme = "light",
}: ModalProps) {
    const [isMounted, setIsMounted] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [isOpen, onClose]);

    if (!isMounted || !isOpen) return null;

    const isDark = theme === "dark";

    const typeStyles = {
        info: {
            icon: "i",
            iconClass: isDark ? "bg-blue-900/40 text-blue-400" : "bg-blue-100 text-blue-700",
            btnClass: "btn-primary",
        },
        warning: {
            icon: "!",
            iconClass: isDark ? "bg-amber-900/40 text-amber-400" : "bg-amber-100 text-amber-700",
            btnClass: "btn-secondary",
        },
        danger: {
            icon: "!",
            iconClass: isDark ? "bg-red-900/40 text-red-500" : "bg-red-100 text-red-700",
            btnClass: "btn-danger",
        },
        success: {
            icon: "check",
            iconClass: isDark ? "bg-emerald-900/40 text-emerald-400" : "bg-emerald-100 text-emerald-700",
            btnClass: "btn-primary",
        },
    }[type];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
            <button className="absolute inset-0 modal-backdrop border-0" onClick={onClose} aria-label="Close modal" />

            <div className={`relative w-full max-w-md rounded-3xl border shadow-2xl overflow-hidden ${isDark ? 'border-slate-700 bg-slate-900' : 'border-slate-200 bg-white'}`}>
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`h-11 w-11 rounded-xl flex shrink-0 items-center justify-center text-sm font-bold uppercase ${typeStyles.iconClass}`}>
                            {typeStyles.icon}
                        </div>
                        <div>
                            <h2 className={`text-lg font-bold leading-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{title}</h2>
                            <p className={`text-sm mt-2 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{message}</p>
                        </div>
                    </div>
                </div>

                <div className={`px-6 py-4 flex justify-end gap-2 border-t ${isDark ? 'bg-slate-950 border-slate-800' : 'bg-slate-50 border-slate-200'}`}>
                    <button onClick={onClose} className="btn btn-ghost" disabled={isSubmitting}>
                        {cancelText}
                    </button>

                    {onConfirm && (
                        <button
                            onClick={async () => {
                                setIsSubmitting(true);
                                try {
                                    await onConfirm();
                                    onClose();
                                } finally {
                                    setIsSubmitting(false);
                                }
                            }}
                            className={`btn ${typeStyles.btnClass}`}
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? "Working..." : confirmText}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
