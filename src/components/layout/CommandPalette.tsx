"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";

type Command = {
    id: string;
    label: string;
    description: string;
    keywords: string[];
    hint?: string;
    run: () => void;
};

const starterPayload = `{
  "title": "Starter NACC Set",
  "date": "23 Feb 2026",
  "instituteName": "NACC AGRICULTURE INSTITUTE",
  "questions": [
    {
      "number": "1",
      "questionHindi": "उचित सिंचाई समय क्या है?",
      "questionEnglish": "What is the right irrigation timing?",
      "options": [
        { "hindi": "सुबह", "english": "Morning" },
        { "hindi": "दोपहर", "english": "Afternoon" },
        { "hindi": "शाम", "english": "Evening" },
        { "hindi": "रात", "english": "Night" }
      ]
    }
  ],
  "templateId": "professional"
}`;

export default function CommandPalette() {
    const router = useRouter();
    const [isOpen, setIsOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    const commands = useMemo<Command[]>(
        () => [
            {
                id: "go-dashboard",
                label: "Open Dashboard",
                description: "View workspace summary and recent activity",
                keywords: ["home", "dashboard", "overview"],
                hint: "Route",
                run: () => router.push("/"),
            },
            {
                id: "go-generate",
                label: "Create JSON PDF",
                description: "Open JSON to PDF builder",
                keywords: ["create", "json", "builder", "new", "pdf"],
                hint: "Route",
                run: () => router.push("/generate"),
            },
            {
                id: "go-image",
                label: "Open Image Extractor",
                description: "Convert question screenshots into structured PDFs",
                keywords: ["image", "ocr", "extract", "vision"],
                hint: "Route",
                run: () => router.push("/image-to-pdf"),
            },
            {
                id: "go-history",
                label: "Open History",
                description: "Inspect and reuse previous documents",
                keywords: ["history", "documents", "reuse", "archive"],
                hint: "Route",
                run: () => router.push("/history"),
            },
            {
                id: "go-library",
                label: "Open Book Library",
                description: "Browse uploaded books and references",
                keywords: ["books", "library", "upload", "search"],
                hint: "Route",
                run: () => router.push("/books"),
            },
            {
                id: "copy-doc-api",
                label: "Copy Documents API Endpoint",
                description: "Copy `/api/documents` URL to clipboard",
                keywords: ["api", "documents", "copy", "endpoint"],
                hint: "Action",
                run: async () => {
                    await navigator.clipboard.writeText(`${window.location.origin}/api/documents`);
                    toast.success("Documents endpoint copied");
                },
            },
            {
                id: "copy-json-starter",
                label: "Copy Starter JSON Payload",
                description: "Copy ready-to-edit template payload",
                keywords: ["starter", "payload", "template", "json", "clipboard"],
                hint: "Action",
                run: async () => {
                    await navigator.clipboard.writeText(starterPayload);
                    toast.success("Starter payload copied");
                },
            },
        ],
        [router]
    );

    const filteredCommands = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return commands;
        return commands.filter((cmd) =>
            `${cmd.label} ${cmd.description} ${cmd.keywords.join(" ")}`.toLowerCase().includes(q)
        );
    }, [commands, query]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query, isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        inputRef.current?.focus();
    }, [isOpen]);

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        if (isOpen) {
            document.body.style.overflow = "hidden";
        } else {
            document.body.style.overflow = previousOverflow;
        }

        return () => {
            document.body.style.overflow = previousOverflow;
        };
    }, [isOpen]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const isShortcut = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";
            if (isShortcut) {
                event.preventDefault();
                setIsOpen((prev) => !prev);
                return;
            }

            if (!isOpen) return;

            if (event.key === "Escape") {
                event.preventDefault();
                setIsOpen(false);
                return;
            }

            if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, filteredCommands.length - 1));
                return;
            }

            if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, 0));
                return;
            }

            if (event.key === "Enter") {
                event.preventDefault();
                const selected = filteredCommands[selectedIndex];
                if (!selected) return;

                Promise.resolve(selected.run())
                    .then(() => {
                        setIsOpen(false);
                        setQuery("");
                    })
                    .catch((err) => {
                        console.error(err);
                        toast.error("Command failed");
                    });
            }
        };

        const onOpenRequest = () => {
            setIsOpen(true);
        };

        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("open-command-palette", onOpenRequest as EventListener);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("open-command-palette", onOpenRequest as EventListener);
        };
    }, [filteredCommands, isOpen, selectedIndex]);

    if (!isOpen) return null;

    return (
        <div
            className="command-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                    setIsOpen(false);
                }
            }}
        >
            <div className="command-panel">
                <div className="command-input-wrap">
                    <span className="cmd-kbd">K</span>
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="command-input"
                        placeholder="Type a command or route..."
                    />
                    <button className="btn btn-ghost text-xs" onClick={() => setIsOpen(false)}>
                        Close
                    </button>
                </div>

                <div className="command-list">
                    {filteredCommands.length === 0 ? (
                        <div className="command-empty">No matching commands</div>
                    ) : (
                        filteredCommands.map((cmd, index) => (
                            <button
                                key={cmd.id}
                                className={`command-item ${selectedIndex === index ? "command-item-active" : ""}`}
                                onMouseEnter={() => setSelectedIndex(index)}
                                onClick={() => {
                                    Promise.resolve(cmd.run())
                                        .then(() => {
                                            setIsOpen(false);
                                            setQuery("");
                                        })
                                        .catch((err) => {
                                            console.error(err);
                                            toast.error("Command failed");
                                        });
                                }}
                            >
                                <div>
                                    <p className="command-item-title">{cmd.label}</p>
                                    <p className="command-item-desc">{cmd.description}</p>
                                </div>
                                <span className="cmd-kbd">{cmd.hint || "Run"}</span>
                            </button>
                        ))
                    )}
                </div>

                <div className="command-footer">
                    <span>
                        <span className="cmd-kbd">↑↓</span> navigate
                    </span>
                    <span>
                        <span className="cmd-kbd">Enter</span> run
                    </span>
                    <span>
                        <span className="cmd-kbd">Esc</span> close
                    </span>
                </div>
            </div>
        </div>
    );
}
