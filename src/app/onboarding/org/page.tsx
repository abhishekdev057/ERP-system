"use client";

import { useState, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { Building2, Upload, MapPin, FileText, CheckCircle, ArrowRight, Loader, Search } from "lucide-react";
import toast from "react-hot-toast";

type OrgType = "COACHING" | "SCHOOL" | "ACADEMY" | "UNIVERSITY" | "OTHER";

const ORG_TYPES: { value: OrgType; label: string; emoji: string }[] = [
    { value: "COACHING", label: "Coaching Institute", emoji: "📚" },
    { value: "SCHOOL", label: "School", emoji: "🏫" },
    { value: "ACADEMY", label: "Academy", emoji: "🎓" },
    { value: "UNIVERSITY", label: "University / College", emoji: "🏛️" },
    { value: "OTHER", label: "Other", emoji: "🏢" },
];

interface PincodeData {
    Message: string;
    Status: string;
    PostOffice: {
        Name: string;
        Description: string | null;
        BranchType: string;
        DeliveryStatus: string;
        Circle: string;
        District: string;
        Division: string;
        Region: string;
        State: string;
        Country: string;
        Pincode: string;
    }[] | null;
}

export default function OrgOnboardingWizard() {
    const { data: session, status, update: updateSession } = useSession();

    const [step, setStep] = useState(1);
    const [saving, setSaving] = useState(false);

    // Step 1: Logo
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const fileRef = useRef<HTMLInputElement>(null);

    // Step 2: Org Info
    const [description, setDescription] = useState("");
    const [orgType, setOrgType] = useState<OrgType>("COACHING");

    // Location Hierarchy
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

        if (userRole === "MEMBER") {
            window.location.href = "/onboarding/member";
            return;
        }

        if (userRole !== "ORG_ADMIN") {
            window.location.href = "/";
        }
    }, [session, status]);

    const selectFile = (file: File) => {
        if (!file?.type.startsWith("image/")) {
            toast.error("Please upload an image file");
            return;
        }
        setLogoFile(file);
        setLogoPreview(URL.createObjectURL(file));
    };

    // Auto-fetch location on 6-digit pincode
    useEffect(() => {
        if (pincode.length === 6 && /^\d{6}$/.test(pincode)) {
            fetchPincodeDetails(pincode);
        } else {
            setLocations(null);
            setDistrict("");
            setState("");
            setPincodeError("");
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
                setPincodeError("Invalid Pincode or no data found");
                setLocations(null);
            }
        } catch (err) {
            setPincodeError("Failed to fetch location data");
            console.error("Pincode API Error:", err);
        } finally {
            setIsFetchingPincode(false);
        }
    };

    const handleComplete = async () => {
        // Fallback: If Pincode API fails but user entered a manual district/state (optional now due to API flakiness)
        if (!pincode && (!district || !state)) {
            // Let them proceed even if location is empty to avoid blocking onboarding
        }

        setSaving(true);
        try {
            // Upload logo if provided
            if (logoFile) {
                const fd = new FormData();
                fd.append("file", logoFile);
                const uploadRes = await fetch("/api/uploads/logo", { method: "POST", body: fd });
                if (!uploadRes.ok) {
                    const err = await uploadRes.json();
                    toast.error(err.error || "Logo upload failed");
                    setSaving(false);
                    return;
                }
            }

            // Construct full hierarchical city string
            const fullLocation = district ? `${selectedLocation || pincode}, ${district}, ${state}` : "Location not provided";

            // Save org info + mark onboarding done in DB
            const res = await fetch("/api/onboarding/org", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    description,
                    city: fullLocation,
                    orgType
                }),
            });

            if (!res.ok) {
                toast.error("Failed to save organization info");
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
        // Hard redirect with cache-busting to bypass aggressive Next.js App Router loops
        window.location.href = "/?refresh=" + Date.now();
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute -top-40 -right-40 w-96 h-96 bg-blue-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse" />
                <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-indigo-200 rounded-full mix-blend-multiply filter blur-3xl opacity-30 animate-pulse" style={{ animationDelay: "1.5s" }} />
            </div>

            <div className="relative w-full max-w-xl">
                <div className="text-center mb-8">
                    <div className="inline-flex items-center gap-2 mb-2">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                            <span className="text-white font-extrabold text-lg">N</span>
                        </div>
                        <span className="font-extrabold text-slate-900 text-xl">Nexora by Sigma Fusion</span>
                    </div>
                    <p className="text-slate-500 text-sm">Let's set up your organization workspace</p>
                </div>

                <div className="flex items-center gap-2 mb-8">
                    {[1, 2, 3].map((s) => (
                        <div key={s} className="flex-1">
                            <div className={`h-1.5 rounded-full transition-all duration-500 ${s <= step ? "bg-blue-600" : "bg-slate-200"}`} />
                        </div>
                    ))}
                </div>

                <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/60 overflow-hidden">
                    {/* STEP 1: Logo Upload */}
                    {step === 1 && (
                        <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-blue-50 flex items-center justify-center">
                                    <Building2 className="w-5 h-5 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Step 1 of 3</p>
                                    <h2 className="text-xl font-extrabold text-slate-900 leading-tight">Upload your organization logo</h2>
                                </div>
                            </div>

                            <p className="text-sm text-slate-500 mb-6">This will appear across your workspace pages and help identify your institute.</p>

                            <div
                                onClick={() => fileRef.current?.click()}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => { e.preventDefault(); e.dataTransfer.files[0] && selectFile(e.dataTransfer.files[0]); }}
                                className="relative border-2 border-dashed border-slate-200 rounded-2xl p-10 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/40 transition-all duration-300 group"
                            >
                                {logoPreview ? (
                                    <div className="flex flex-col items-center gap-4">
                                        <img src={logoPreview} alt="Logo preview" className="w-24 h-24 object-contain rounded-xl ring-4 ring-blue-100" />
                                        <p className="text-sm text-slate-500">Click to change</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-3">
                                        <div className="w-16 h-16 rounded-2xl bg-slate-100 group-hover:bg-blue-100 flex items-center justify-center transition-colors">
                                            <Upload className="w-7 h-7 text-slate-400 group-hover:text-blue-500 transition-colors" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-700">Drop your logo here</p>
                                            <p className="text-xs text-slate-400 mt-1">PNG, JPG, SVG, WEBP — up to 5MB</p>
                                        </div>
                                    </div>
                                )}
                                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && selectFile(e.target.files[0])} />
                            </div>

                            <div className="flex gap-3 mt-8">
                                <button onClick={() => setStep(2)} className="flex-1 text-slate-500 border border-slate-200 rounded-xl py-3 text-sm font-semibold hover:bg-slate-50 transition">
                                    Skip for now
                                </button>
                                <button onClick={() => setStep(2)} className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2">
                                    Continue <ArrowRight className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 2: Org Info */}
                    {step === 2 && (
                        <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="flex items-center gap-3 mb-6">
                                <div className="w-10 h-10 rounded-2xl bg-emerald-50 flex items-center justify-center">
                                    <FileText className="w-5 h-5 text-emerald-600" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-400 font-semibold uppercase tracking-widest">Step 2 of 3</p>
                                    <h2 className="text-xl font-extrabold text-slate-900 leading-tight">Tell us about your institute</h2>
                                </div>
                            </div>

                            <div className="space-y-5">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-2">Institute Type</label>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {ORG_TYPES.map((t) => (
                                            <button
                                                key={t.value}
                                                type="button"
                                                onClick={() => setOrgType(t.value)}
                                                className={`flex items-center gap-2 p-3 rounded-xl border-2 text-sm font-medium transition-all ${orgType === t.value
                                                    ? "border-blue-500 bg-blue-50 text-blue-700"
                                                    : "border-slate-200 hover:border-slate-300 text-slate-600"
                                                    }`}
                                            >
                                                <span>{t.emoji}</span> {t.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Pincode Section */}
                                <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 space-y-4">
                                    <div className="flex items-center gap-2 text-slate-600 mb-1">
                                        <MapPin className="w-4 h-4" />
                                        <span className="text-xs font-bold uppercase tracking-wider">Location Setup</span>
                                    </div>

                                    <div>
                                        <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Indian Pincode</label>
                                        <div className="relative">
                                            <input
                                                type="text"
                                                value={pincode}
                                                onChange={(e) => setPincode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                                placeholder="Enter 6-digit Pincode"
                                                className="w-full py-3 px-4 pr-12 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono tracking-widest"
                                            />
                                            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                                                {isFetchingPincode ? (
                                                    <Loader className="w-5 h-5 text-blue-500 animate-spin" />
                                                ) : (
                                                    <Search className="w-5 h-5 text-slate-300" />
                                                )}
                                            </div>
                                        </div>
                                        {pincodeError && <p className="text-[11px] text-red-500 mt-1 ml-1 font-medium">{pincodeError}</p>}
                                    </div>

                                    {locations && locations.length > 0 && (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 animate-in fade-in duration-300">
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">Village / Area</label>
                                                <select
                                                    value={selectedLocation}
                                                    onChange={(e) => setSelectedLocation(e.target.value)}
                                                    className="w-full py-3 px-4 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                                                >
                                                    {locations.map((loc, idx) => (
                                                        <option key={idx} value={loc.Name}>{loc.Name}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 ml-1">District & State</label>
                                                <div className="w-full py-3 px-4 rounded-xl border border-slate-100 bg-slate-100/50 text-slate-500 text-sm font-medium truncate">
                                                    {district}, {state}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5 ml-1">Short Description</label>
                                    <textarea
                                        value={description}
                                        onChange={(e) => setDescription(e.target.value)}
                                        rows={3}
                                        placeholder="Specialization, focus area, etc..."
                                        className="w-full py-3 px-4 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm resize-none"
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 mt-8">
                                <button onClick={() => setStep(1)} className="flex-1 text-slate-500 border border-slate-200 rounded-xl py-3 text-sm font-semibold hover:bg-slate-50 transition">
                                    Back
                                </button>
                                <button
                                    onClick={handleComplete}
                                    disabled={saving || isFetchingPincode}
                                    className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg shadow-blue-500/20"
                                >
                                    {saving ? <><Loader className="w-4 h-4 animate-spin" /> Saving...</> : <>Finish Setup <ArrowRight className="w-4 h-4" /></>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* STEP 3: Celebration */}
                    {step === 3 && (
                        <div className="p-8 text-center animate-in fade-in zoom-in-95 duration-700">
                            <div className="relative inline-block mb-6">
                                <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto shadow-inner">
                                    <CheckCircle className="w-12 h-12 text-emerald-500" />
                                </div>
                                <div className="absolute -top-2 -right-2 text-3xl animate-bounce">🎉</div>
                            </div>

                            <h2 className="text-2xl font-extrabold text-slate-900 mb-3">Your workspace is ready!</h2>
                            <p className="text-slate-500 text-sm mb-8 max-w-md mx-auto leading-relaxed italic">
                                "Nexora by Sigma Fusion is the complete operating system for modern coachings, schools, and academies. Access your secure workspace."
                            </p>

                            <button
                                onClick={handleGoToDashboard}
                                className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl py-4 text-sm font-bold hover:opacity-90 transition flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30"
                            >
                                Go to Dashboard <ArrowRight className="w-4 h-4" />
                            </button>
                        </div>
                    )}
                </div>

                <p className="text-center text-[11px] text-slate-400 mt-6 font-medium">
                    POWERED BY <span className="text-slate-500 font-bold">NEXORA BY SIGMA FUSION</span> • INSTITUTE MANAGEMENT OPERATING SYSTEM
                </p>
            </div>
        </div>
    );
}
