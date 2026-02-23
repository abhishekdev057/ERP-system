"use client";

import { useEffect, useState } from "react";

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm?: () => void;
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

    useEffect(() => {
        setIsMounted(true);
    }, []);

    if (!isMounted || !isOpen) return null;

    const getTypeStyles = () => {
        switch (type) {
            case "danger":
                return {
                    iconBg: "bg-red-100",
                    iconColor: "text-red-600",
                    btnBg: "bg-red-600 hover:bg-red-700",
                    borderColor: "border-red-100",
                };
            case "warning":
                return {
                    iconBg: "bg-amber-100",
                    iconColor: "text-amber-600",
                    btnBg: "bg-amber-500 hover:bg-amber-600",
                    borderColor: "border-amber-100",
                };
            case "success":
                return {
                    iconBg: "bg-emerald-100",
                    iconColor: "text-emerald-600",
                    btnBg: "bg-emerald-500 hover:bg-emerald-600",
                    borderColor: "border-emerald-100",
                };
            default:
                return {
                    iconBg: "bg-blue-100",
                    iconColor: "text-blue-600",
                    btnBg: "bg-blue-600 hover:bg-blue-700",
                    borderColor: "border-blue-100",
                };
        }
    };

    const styles = getTypeStyles();

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 overflow-hidden">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity duration-300 animate-fade-in"
                onClick={onClose}
            />

            {/* Modal Content */}
            <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden animate-fade-in-up border border-slate-100">
                <div className="p-6">
                    <div className="flex items-start gap-4">
                        <div className={`w-12 h-12 rounded-2xl flex-shrink-0 flex items-center justify-center ${styles.iconBg} ${styles.iconColor}`}>
                            {type === "danger" && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2m-6 9 2 2 4-4" /></svg>
                            )}
                            {type === "warning" && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 9 4 4-4 4" /><path d="M12 3v12" /><path d="m8 11 4-4 4 4" /></svg>
                            )}
                            {type === "info" && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
                            )}
                            {type === "success" && (
                                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                            )}
                        </div>
                        <div className="flex-1">
                            <h3 className="text-xl font-bold text-slate-900 leading-tight mb-2">{title}</h3>
                            <p className="text-sm text-slate-500 leading-relaxed">{message}</p>
                        </div>
                    </div>
                </div>

                <div className="bg-slate-50/50 p-4 px-6 flex items-center justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-5 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
                    >
                        {cancelText}
                    </button>
                    {onConfirm && (
                        <button
                            onClick={() => {
                                onConfirm();
                                onClose();
                            }}
                            className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-lg transition-all active:scale-95 ${styles.btnBg}`}
                        >
                            {confirmText}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
