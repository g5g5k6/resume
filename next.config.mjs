/** @type {import('next').NextConfig} */
const nextConfig = {
  // The site serves the Owner's real resume data on a public, unauthenticated
  // URL (Vercel Hobby has no password gate). Keep that data out of search
  // results: an X-Robots-Tag header applies to every response — including
  // non-HTML routes and crawlers that don't execute JS — so it's stronger than
  // a <meta name="robots"> tag. A friend with the direct link is unaffected.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
