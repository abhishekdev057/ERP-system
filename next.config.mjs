/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        serverActions: {
            bodySizeLimit: "10mb",
        },
        serverComponentsExternalPackages: ["pdfkit"],
    },
};

export default nextConfig;
