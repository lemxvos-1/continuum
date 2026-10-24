import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Café Aurora — Café artesanal" },
      { name: "description", content: "Café artesanal torrado em pequenos lotes, direto para sua casa." },
      { property: "og:title", content: "Café Aurora — Café artesanal" },
      { property: "og:description", content: "Café artesanal torrado em pequenos lotes, direto para sua casa." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center">
      <h1 className="text-5xl font-bold text-foreground">Café Aurora</h1>
      <p className="mt-4 max-w-md text-lg text-muted-foreground">
        Café artesanal torrado em pequenos lotes, direto para sua casa.
      </p>
      <a
        href="mailto:contato@cafeaurora.com"
        className="mt-8 rounded-md bg-primary px-6 py-3 font-medium text-primary-foreground"
      >
        Fale conosco
      </a>
    </main>
  );
}
