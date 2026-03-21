"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { User, Upload, BookOpen, CheckCircle, ArrowRight, Loader, MapPin, Search } from "lucide-react";
import toast from "react-hot-toast";

type Designation = "TEACHER" | "STUDENT" | "STAFF" | "CONTENT_CREATOR" | "COORDINATOR" | "OTHER";

const DESIGNATIONS: { value: Designation; label: string; emoji: string }[] = [
    { value: "STUDENT", label: "Student", emoji: "🎒" },
    { value: "TEACHER", label: "Teacher / Faculty", emoji: "👨‍🏫" },
    { value: "STAFF", label: "Support Staff", emoji: "🧑‍💼" },
    { value: "COORDINATOR", label: "Coordinator", emoji: "📋" },
    { value: "CONTENT_CREATOR", label: "Content Creator", emoji: "✍️" },
    { value: "OTHER", label: "Other", emoji: "👤" },
];

interface PincodeData {
    Message: string;
    Status: string;
    PostOffice: {
        Name: string;
        District: string;
        State: string;
    }[] | null;
}

export default function MemberOnboardingWizard() {
    const { data: session, status, update: updateSession } = useSession();

    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);

    // Step 1: Photo
    const [photoFile, setPhotoFile] = useState<File | null>(null);
    const [photoPreview, setPhotoPreview] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Step 2: Role & Bio
    const [designation, setDesignation] = useState<Designation>("STUDENT");
    const [bio, setBio] = useState("");

    // Location (New)
    const [pincode, setPincode] = useState("");
    const [isFetchingPincode, setIsFetchingPincode] = useState(false);
    const [pincodeError, setPincodeError] = useState("");
    const [locations, setLocations] = useState<PincodeData["PostOffice"]>(null);
    const [selectedLocation, setSelectedLocation] = useState("");
    const [district, setDistrict] = useState("");
    const [state, setState] = useState("");

    useEffect(() => {
        if (status !== "authenticated") return;

        const userRole = session?.user?.role;
        const done = Boolean((session?.user as any)?.onboardingDone);

        if (done) {
            window.location.href = "/";
            return;
        }

        if (userRole === "ORG_ADMIN") {
            window.location.href = "/onboarding/org";
            return;
        }

        if (userRole !== "MEMBER") {
            window.location.href = "/";
        }
    }, [session, status]);

    const selectFile = (file: File) => {
        if (!file?.type.startsWith("image/")) {
            toast.error("Please upload an image file");
            return;
        }
        setPhotoFile(file);
        setPhotoPreview(URL.createObjectURL(file));
    };

    // Auto-fetch location on 6-digit pincode
    useEffect(() => {
        if (pincode.length === 6 && /^\d{6}$/.test(pincode)) {
            fetchPincodeDetails(pincode);
        } else {
            setLocations(null);
            setDistrict("");
            setState("");
        }
    }, [pincode]);

    const fetchPincodeDetails = async (pin: string) => {
        setIsFetchingPincode(true);
        setPincodeError("");
        try {
            const res = await fetch(`https://api.postalpincode.in/pincode/${pin}`);
            const data: PincodeData[] = await res.json();

            if (data[0].Status === "Success" && data[0].PostOffice) {
                const po = data[0].PostOffice;
                setLocations(po);
                setDistrict(po[0].District);
                setState(po[0].State);
                setSelectedLocation(po[0].Name);
            } else {
                setPincodeError("Invalid Pincode");
                setLocations(null);
            }
        } catch {
            setPincodeError("Fetching failed");
            setLocations(null);
        } finally {
            setIsFetchingPincode(false);
        }
    };

    const handleComplete = async () => {
        setSaving(true);
        try {
            // Upload photo
            if (photoFile) {
                const fd = new FormData();
                fd.append("file", photoFile);
                const uploadRes = await fetch("/api/uploads/avatar", { method: "POST", body: fd });
                if (!uploadRes.ok) {
                    toast.error("Photo upload failed");
                    setSaving(false);
                    return;
                }
            }

            // Optional full location, fallback to pincode or empty
            const fullLocation = district ? `${selectedLocation}, ${district}, ${state}` : pincode || "Location not provided";

            // Save member profile
            const res = await fetch("/api/onboarding/member", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    designation,
                    bio,
                    city: fullLocation // We'll add this to the API
                }),
            });

            if (!res.ok) {
                toast.error("Failed to save profile");
                setSaving(false);
                return;
            }

            // Force session update via POST to rewrite cookie
            await updateSession({ forceUpdate: true });
            setStep(3);
        } catch {
            toast.error("Something went wrong");
            setSaving(false);
        } finally {
            setSaving(false);
        }
    };

    const handleGoToDashboard = async () => {
        await updateSession({ forceUpdate: true });
        window.location.href = "/?refresh=" + Date.now();
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-violet-50 to-purple-100 flex items-center justify-center p-4">
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-purple-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse" style={{ animationDelay: "2s" }} />
            </div>

            <div className="relative w-full max-w-xl">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-2">
                        <div className="w-10 h-10 bg-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/20">
                            <span className="text-white font-extrabold text-lg">N</span>
                        </div>
                        <span className="font-extrabold text-slate-900 text-xl tracking-tight">Nexora by Sigma Fusion</span>
                    </div>
                    <p className="text-slate-500 text-sm font-medium">Let's personalize your workspace profile</p>
                </div>

                <div className="flex gap-2 mb-8">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="flex-1">
                            <div className={`h-1.5 rounded-full transition-all duration-500 ${s <= step ? "bg-violet-600" : "bg-slate-200"}`} />
                        </div>
                    ))}
                </div>

                <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/60 overflow-hidden border border-slate-100">

                    {/* STEP 1: Profile Photo */}
                    {step === 1 && (
                        <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-violet-50 flex items-center justify-center">
                                    <User className="w-5 h-5 text-violet-600" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Step 1 of 3</p>
                                    <h2 className="text-xl font-extrabold text-slate-900 leading-tight">Upload your photo</h2>
                                </div>
                            </div>

                            <p className="text-sm text-slate-500 mb-6">Your photo will appear in the workspace so your team can recognize you.</p>

                            <div
                                onClick={() => fileRef.current?.click()}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && selectFile(e.dataTransfer.files[0]); }}
                                className="border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center cursor-pointer hover:border-violet-400 hover:bg-violet-50/40 transition-all duration-300 group"
                            >
                                {photoPreview ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <img src={photoPreview} alt="Preview" className="w-24 h-24 rounded-full object-cover ring-4 ring-violet-100 shadow-md" />
                                        <p className="text-sm text-slate-500 font-medium">Click to change</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-20 h-20 rounded-full bg-slate-100 group-hover:bg-violet-100 flex items-center justify-center transition-colors">
                                            <Upload className="w-7 h-7 text-slate-400 group-hover:text-violet-500 transition-colors" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-700">Drop your photo here</p>
                                            <p className="text-xs text-slate-400 mt-1">PNG, JPG, WEBP — up to 5MB</p>
                                        </div>
                                    </div>
                                )}
                                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])} />
                            </div>

                            <div className="flex gap-3 mt-8">
                                <button onClick={() => setStep(2)} className="flex-1 border border-slate-200 text-slate-500 rounded-xl py-3 text-sm font-semibold hover:bg-slate-50 transition">
                                    Skip for now
                                </button>
                                <button onClick={() => setStep(2)} className="flex-1 bg-violet-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-violet-700 transition flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20">
                                    Continue <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Role & Hierarchy Location */}
                    {step === 2 && (
                        <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center">
                                    <BookOpen className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Step 2 of 3</p>
                                    <h2 className="text-xl font-extrabold text-slate-900 leading-tight">About you</h2>
                                </div>
                            </div>

                            <div className="space-y-6">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2.5 ml-1">My Role</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {DESIGNATIONS.map((d) => (
                                            <button
                                                key={d.value}
                                                type="button"
                                                onClick={() => setDesignation(d.value)}
                                                className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${designation === d.value
                                                    ? "border-violet-500 bg-violet-50 text-violet-700 shadow-sm"
                                                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                                                    }`}
                                            >
                                                <span className="text-lg">{d.emoji}</span> {d.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Precise Location */}
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                                    <div className="flex items-center gap-2 text-slate-600 mb-1">
                                        <MapPin className="w-4 h-4" />
                                        <span className="text-xs font-bold uppercase tracking-wider">My Base Location</span>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Pincode</label>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={pincode}
                                                    onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                                    placeholder="6 digits"
                                                    className="w-full py-2.5 px-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm font-mono tracking-widest"
                                                />
                                                {isFetchingPincode && <Loader className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-violet-500 animate-spin" />}
                                            </div>
                                            {pincodeError && <p className="text-[10px] text-red-500 mt-1 ml-1 font-bold">{pincodeError}</p>}
                                        </div>

                                        {locations && (
                                            <div className="animate-in fade-in duration-300">
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Village/Area</label>
                                                <select
                                                    value={selectedLocation}
                                                    onChange={(e) => setSelectedLocation(e.target.value)}
                                                    className="w-full py-2.5 px-3 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 text-xs"
                                                >
                                                    {locations.map((loc, idx) => (
                                                        <option key={idx} value={loc.Name}>{loc.Name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                    {district && (
                                        <p className="text-[11px] text-slate-500 font-semibold ml-1 flex items-center gap-1.5">
                                            <span className="w-1 h-1 bg-violet-400 rounded-full" /> {district}, {state}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5 ml-1">Short Bio <span className="text-slate-400 font-normal">(optional)</span></label>
                                    <textarea
                                        value={bio}
                                        onChange={(e) => setBio(e.target.value)}
                                        rows={2}
                                        maxLength={100}
                                        placeholder="Brief summary of your work/expertise..."
                                        className="w-full py-3 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm resize-none"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 mt-8">
                                <button onClick={() => setStep(1)} className="flex-1 border border-slate-200 text-slate-500 rounded-xl py-3 text-sm font-semibold hover:bg-slate-50 transition">
                                    Back
                                </button>
                                <button
                                    onClick={handleComplete}
                                    disabled={saving || isFetchingPincode}
                                    className="flex-1 bg-violet-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-violet-700 transition flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-violet-500/20"
                                >
                                    {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving...</> : <>Finish Profile <ArrowRight className="w-4 h-4" /></>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: Celebration */}
                    {step === 3 && (
                        <div className="p-8 text-center animate-in fade-in zoom-in-95 duration-700">
                            <div className="relative inline-block mb-6">
                                <div className="w-24 h-24 bg-violet-100 rounded-full flex items-center justify-center mx-auto shadow-inner">
                                    <CheckCircle className="w-12 h-12 text-violet-500" />
                                </div>
                                <div className="absolute -top-2 -right-2 text-3xl animate-bounce">🌟</div>
                            </div>

                            <h2 className="text-2xl font-extrabold text-slate-900 mb-3 tracking-tight">Your profile is set!</h2>
                            <p className="text-slate-500 text-sm mb-8 max-w-md mx-auto leading-relaxed italic">
                                "Nexora by Sigma Fusion is the complete operating system for modern coachings, schools, and academies. Access your secure workspace."
                            </p>

                            <button
                                onClick={handleGoToDashboard}
                                className="w-full bg-gradient-to-r from-violet-600 to-purple-600 text-white rounded-xl py-4 text-sm font-bold hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg shadow-violet-500/30"
                            >
                                Go to Dashboard <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>

                <p className="text-center text-[11px] text-slate-400 mt-6 font-bold tracking-widest uppercase">
                    POWERED BY <span className="text-slate-700">NEXORA BY SIGMA FUSION</span>
                </p>
            </div>
        </div>
    );
}
