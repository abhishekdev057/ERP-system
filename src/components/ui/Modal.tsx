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

    const typeStyles = {
        info: {
            icon: "i",
            iconClass: "bg-blue-100 text-blue-700",
            btnClass: "btn-primary",
        },
        warning: {
            icon: "!",
            iconClass: "bg-amber-100 text-amber-700",
            btnClass: "btn-secondary",
        },
        danger: {
            icon: "!",
            iconClass: "bg-red-100 text-red-700",
            btnClass: "btn-danger",
        },
        success: {
            icon: "check",
            iconClass: "bg-emerald-100 text-emerald-700",
            btnClass: "btn-primary",
        },
    }[type];

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
            <button className="absolute inset-0 modal-backdrop border-0" onClick={onClose} aria-label="Close modal" />

            <div className="relative w-full max-w-md rounded-3xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`h-11 w-11 rounded-xl flex items-center justify-center text-sm font-bold uppercase ${typeStyles.iconClass}`}>
                            {typeStyles.icon}
                        </div>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 leading-tight">{title}</h2>
                            <p className="text-sm text-slate-600 mt-2 leading-relaxed">{message}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-slate-50 border-t border-slate-200 px-6 py-4 flex justify-end gap-2">
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
