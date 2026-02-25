import dynamicImport from "next/dynamic";

export const dynamic = "force-dynamic";

const WhiteboardWorkspace = dynamicImport(
    () => import("@/components/whiteboard/WhiteboardWorkspace"),
    { ssr: false }
);

export default function WhiteboardPage() {
    return <WhiteboardWorkspace />;
}
