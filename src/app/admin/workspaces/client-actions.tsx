"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <button
            type="button"
            onClick={handleCopy}
            title="Copy Org ID"
            className="text-slate-400 hover:text-slate-700 transition-colors"
        >
            {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
        </button>
    );
}

export function DeleteOrgButton({ orgName }: { orgName: string }) {
    return (
        <button
            type="submit"
            className="text-xs text-red-500 hover:text-red-700 font-medium transition-colors"
            onClick={(e) => {
                if (!confirm(`Delete "${orgName}"? This will also remove all their data.`)) {
                    e.preventDefault();
                }
            }}
        >
            Delete Institute
        </button>
    );
}
