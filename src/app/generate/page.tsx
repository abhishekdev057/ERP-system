import { redirect } from "next/navigation";

type LegacyPageProps = {
    searchParams?: Record<string, string | string[] | undefined>;
};

function buildQuery(searchParams: LegacyPageProps["searchParams"]): string {
    if (!searchParams) return "";
    const query = new URLSearchParams();

    Object.entries(searchParams).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            value.forEach((item) => {
                if (item) query.append(key, item);
            });
            return;
        }
        if (value) query.set(key, value);
    });

    const output = query.toString();
    return output ? `?${output}` : "";
}

export default function LegacyJsonToPdfRoute({ searchParams }: LegacyPageProps) {
    redirect(`/content-studio/extractor${buildQuery(searchParams)}`);
}
