import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type AddressSuggestion = {
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

const PHOTON_API_URL = "https://photon.komoot.io/api";
const CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_RESULTS = 7;

const addressCache = new Map<string, { expiresAt: number; suggestions: AddressSuggestion[] }>();

function buildLabel(properties: Record<string, unknown>) {
    const locality =
        String(
            properties.village ||
                properties.city ||
                properties.town ||
                properties.hamlet ||
                properties.locality ||
                properties.name ||
                ""
        ).trim();
    const district = String(properties.county || properties.district || "").trim();
    const state = String(properties.state || "").trim();
    const country = String(properties.country || "").trim();

    return [locality, district, state, country].filter(Boolean).join(", ");
}

function normalizeSuggestion(feature: Record<string, unknown>): AddressSuggestion | null {
    const properties =
        feature.properties && typeof feature.properties === "object" && !Array.isArray(feature.properties)
            ? (feature.properties as Record<string, unknown>)
            : null;

    if (!properties) return null;

    const latitude = Number(properties.lat);
    const longitude = Number(properties.lon);
    const label = buildLabel(properties);

    if (!label) return null;

    return {
        label,
        name: String(properties.name || "").trim() || undefined,
        village:
            String(
                properties.village ||
                    properties.hamlet ||
                    properties.locality ||
                    ""
            ).trim() || undefined,
        city:
            String(
                properties.city ||
                    properties.town ||
                    properties.suburb ||
                    ""
            ).trim() || undefined,
        district: String(properties.county || properties.district || "").trim() || undefined,
        state: String(properties.state || "").trim() || undefined,
        country: String(properties.country || "").trim() || undefined,
        postcode: String(properties.postcode || "").trim() || undefined,
        latitude: Number.isFinite(latitude) ? latitude : undefined,
        longitude: Number.isFinite(longitude) ? longitude : undefined,
    };
}

function isAddressSuggestion(value: AddressSuggestion | null): value is AddressSuggestion {
    return Boolean(value);
}

function rankSuggestion(left: AddressSuggestion, right: AddressSuggestion) {
    const leftIndia = left.country?.toLowerCase() === "india" ? 1 : 0;
    const rightIndia = right.country?.toLowerCase() === "india" ? 1 : 0;
    if (rightIndia !== leftIndia) return rightIndia - leftIndia;

    const leftRichness =
        Number(Boolean(left.village)) +
        Number(Boolean(left.city)) +
        Number(Boolean(left.district)) +
        Number(Boolean(left.state));
    const rightRichness =
        Number(Boolean(right.village)) +
        Number(Boolean(right.city)) +
        Number(Boolean(right.district)) +
        Number(Boolean(right.state));

    return rightRichness - leftRichness;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const query = String(searchParams.get("q") || "").trim();

        if (query.length < 3) {
            return NextResponse.json({ suggestions: [] });
        }

        const cacheKey = query.toLowerCase();
        const cached = addressCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return NextResponse.json({ suggestions: cached.suggestions, provider: "photon-cache" });
        }

        const url = new URL(PHOTON_API_URL);
        url.searchParams.set("q", query);
        url.searchParams.set("limit", String(MAX_RESULTS));
        url.searchParams.set("lang", "en");

        const response = await fetch(url.toString(), {
            headers: {
                Accept: "application/json",
                "User-Agent": "NexoraBySigmaFusion/1.0 address-lookup",
            },
            next: { revalidate: 60 * 60 },
        });

        if (!response.ok) {
            throw new Error(`Address service failed with ${response.status}`);
        }

        const payload = (await response.json().catch(() => ({}))) as {
            features?: Array<Record<string, unknown>>;
        };

        const suggestions = Array.from(
            new Map(
                (payload.features || [])
                    .map((feature) => normalizeSuggestion(feature))
                    .filter(isAddressSuggestion)
                    .sort(rankSuggestion)
                    .map((item) => [item.label, item])
            ).values()
        ).slice(0, MAX_RESULTS);

        addressCache.set(cacheKey, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            suggestions,
        });

        return NextResponse.json({
            suggestions,
            provider: "photon",
        });
    } catch (error) {
        console.error("Failed to load address suggestions:", error);
        return NextResponse.json(
            {
                suggestions: [],
                error: error instanceof Error ? error.message : "Failed to load address suggestions",
            },
            { status: 500 }
        );
    }
}
