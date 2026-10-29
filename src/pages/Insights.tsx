import { ReactNode, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FireIcon,
  ClockIcon,
  UsersIcon,
  ArrowTrendingUpIcon,
  ArrowPathIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import AppLayout from "@/components/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { FilterChips } from "@/components/ui/filter-chips";
import { ListRowContent } from "@/components/ui/list-row-content";
import { EntityTypeIcon } from "@/components/ui/entity-type-icon";
import { StickyNote } from "@/lib/heroicons";
import { ScoreEvolutionSection } from "@/components/insights/ScoreEvolutionSection";
import { InsightBadge } from "@/components/InsightSignal";

import { cn } from "@/lib/utils";
import { insightsApi } from "@/lib/api";
import type { MemoryItem } from "@/lib/api";
import { useCachedResource } from "@/hooks/useCachedResource";
import { qk, STALE } from "@/lib/queries";
import { useLanguage } from "@/contexts/LanguageContext";

/* ── Types ────────────────────────────────────────────────────────────── */

interface NoteInsight {
  note: { id: string; title: string; type?: string };
  score: number;
  badge: string;
  mentionCount: number;
  entityConnections: number;
  hoursTracked: number;
  daysSinceLastInteraction: number;
}

interface EntityInsight {
  entity: { id: string; title: string; type?: string };
  score: number;
  badge: string;
  mentionCount: number;
  relationsCount: number;
  hoursTracked: number;
  daysSinceLastMention: number;
}

const EMPTY_NOTE_INSIGHTS: NoteInsight[] = [];
const EMPTY_ENTITY_INSIGHTS: EntityInsight[] = [];

type InsightCategory = "hotNotes" | "hotEntities" | "worthRevisiting" | "forgottenGems";
type View = "all" | InsightCategory;

interface InsightItem {
  id: string;
  kind: "note" | "entity";
  category: InsightCategory;
  score: number;
  normalizedScore: number;
  badge: string;
  title: string;
  subtitle: string;
  metaDetails: {
    mentions?: number;
    links?: number;
    hours?: number;
    daysAgo: number;
  };
  onOpen: () => void;
}

/* ── Meta de Categorias ──────────────────────────────────────────────── */

const CATEGORY_META: Record<InsightCategory, { labelKey: string; subtitleKey: string; icon: typeof FireIcon }> = {
  hotNotes: {
    labelKey: "ins_cat_hot_notes",
    subtitleKey: "ins_cat_hot_notes_sub",
    icon: FireIcon,
  },
  hotEntities: {
    labelKey: "ins_cat_hot_entities",
    subtitleKey: "ins_cat_hot_entities_sub",
    icon: UsersIcon,
  },
  worthRevisiting: {
    labelKey: "ins_cat_worth_revisiting",
    subtitleKey: "ins_cat_worth_revisiting_sub",
    icon: ClockIcon,
  },
  forgottenGems: {
    labelKey: "ins_cat_forgotten_gems",
    subtitleKey: "ins_cat_forgotten_gems_sub",
    icon: ArrowTrendingUpIcon,
  },
};

const categoryOrder: InsightCategory[] = ["hotNotes", "hotEntities", "worthRevisiting", "forgottenGems"];
const MOCK_MEMORY_IMAGE =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 360'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%23d6d3d1'/%3E%3Cstop offset='1' stop-color='%2378716c'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='640' height='360' fill='url(%23g)'/%3E%3Ccircle cx='490' cy='90' r='48' fill='%23f5f5f4' fill-opacity='.7'/%3E%3Cpath d='M0 300 180 150l120 120 90-80 250 170H0' fill='%2344403c' fill-opacity='.55'/%3E%3C/svg%3E";
const MOCK_MEMORIES: MemoryItem[] = [
  {
    noteId: "demo-memory-1",
    title: "Primeiras ideias do projeto",
    excerpt: "Comecei a reunir as ideias centrais e os caminhos possíveis. Rever este registro mostra como as prioridades foram mudando ao longo do tempo.",
    imageUrl: MOCK_MEMORY_IMAGE,
    daysAgo: 30,
    milestone: "30d",
    createdAt: "2026-09-29T12:00:00Z",
  },
  {
    noteId: "demo-memory-2",
    title: "Uma conversa que mudou minha perspectiva",
    excerpt: "Anotei os pontos mais importantes daquela conversa e as perguntas que ficaram. Algumas delas ainda ajudam a orientar minhas decisões.",
    imageUrl: null,
    daysAgo: 90,
    milestone: "90d",
    createdAt: "2026-07-31T12:00:00Z",
  },
  {
    noteId: "demo-memory-3",
    title: "Plano para um novo ciclo",
    excerpt: "Um resumo das metas, referências e pequenos passos que eu queria experimentar durante aquele período.",
    imageUrl: MOCK_MEMORY_IMAGE,
    daysAgo: 365,
    milestone: "365d",
    createdAt: "2025-10-29T12:00:00Z",
  },
];

/* ── Helpers de Formatação e Estilo ─────────────────────────────────── */

const formatHours = (h: number) => {
  if (!h) return null;
  if (h < 1) return `${Math.round(h * 60)}m`;
  return `${h.toFixed(h < 10 ? 1 : 0)}h`;
};

const formatDays = (d: number, t: (key: string, vars?: Record<string, number>) => string) => {
  if (d <= 0) return t("ins_today");
  if (d === 1) return t("ins_days_ago_1");
  if (d < 30) return t("ins_days_ago_n", { count: d });
  if (d < 365) return t("ins_months_ago", { count: Math.floor(d / 30) });
  return t("ins_years_ago", { count: Math.floor(d / 365) });
};

function StatChip({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="rounded-sm border-border/5 bg-foreground/[0.02] px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {children}
    </Badge>
  );
}

/* ── Sidebar Nav Item ─────────────────────────────────────────────────── */

interface NavItemProps {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}

function NavItem({ label, count, active, onClick }: NavItemProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        "group flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[13px] normal-case transition-colors",
        active ? "text-foreground" : "text-muted-foreground hover:text-muted-foreground",
      )}
      onClick={onClick}
    >
      <span className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "h-px w-3 transition-all",
            active ? "bg-foreground w-5" : "bg-foreground/20 group-hover:bg-foreground/40",
          )}
        />
        {label}
      </span>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{count}</span>
    </Button>
  );
}

/* ── Linha do Insight ───────────────────────────────────────────────── */

function InsightRow({ item }: { item: InsightItem }) {
  const { t } = useLanguage();
  return (
    <li className="flex items-center gap-2">
      <button
        onClick={item.onOpen}
        className="group relative flex min-w-0 flex-1 items-center gap-4 py-4 text-left transition-colors hover:bg-foreground/[0.02]"
      >
        <ListRowContent
          icon={
            item.kind === "note" ? (
              <StickyNote className="h-5 w-5" />
            ) : (
              <EntityTypeIcon type={item.subtitle} className="h-5 w-5" />
            )
          }
          title={item.title}
          meta={
            <>
              {item.subtitle}
              {" · "}
              {formatDays(item.metaDetails.daysAgo, t)}
              {item.metaDetails.mentions ? ` · ${t("ins_mentions", { count: item.metaDetails.mentions })}` : ""}
              {item.metaDetails.hours ? ` · ${t("ins_hours_tracked", { hours: formatHours(item.metaDetails.hours) })}` : ""}
            </>
          }
          trailing={
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="rounded-sm border-border/10 bg-transparent px-1.5 py-0 font-mono text-[10px] text-muted-foreground"
                aria-label={`Score ${item.score.toFixed(1)}`}
              >
                {item.score.toFixed(1)}
              </Badge>
            </div>
          }
        />
      </button>
      <InsightBadge
        badge={item.badge}
        category={item.category === "hotNotes" || item.category === "hotEntities" ? "hot" : "forgotten"}
      />
    </li>
  );
}

function memoryMilestoneLabel(
  item: MemoryItem,
  t: (key: string, vars?: Record<string, number>) => string,
) {
  const milestone = item.milestone.toLowerCase();
  if (milestone === "m1" || milestone === "30d") return t("ins_milestone_1m");
  if (milestone === "m3" || milestone === "90d") return t("ins_milestone_3m");
  if (milestone === "m6" || milestone === "180d") return t("ins_milestone_6m");
  if (milestone === "y1" || milestone === "365d") return t("ins_milestone_1y");

  const yearMatch = /^(?:y(\d+)|(\d+)y)$/.exec(milestone);
  const years = yearMatch ? Number(yearMatch[1] ?? yearMatch[2]) : Math.floor(item.daysAgo / 365);
  if (years <= 1) return t("ins_milestone_1y");
  return t("ins_milestone_ny", { years });
}

function MemoryCard({ item, onOpen, isDemo = false }: { item: MemoryItem; onOpen: () => void; isDemo?: boolean }) {
  const { t } = useLanguage();
  const [imageVisible, setImageVisible] = useState(Boolean(item.imageUrl));

  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={isDemo}
      className="group flex min-w-[260px] flex-col overflow-hidden rounded-xl border border-border/10 bg-card text-left transition-colors hover:border-border/25 hover:bg-accent/30 sm:min-w-0"
      aria-label={`${t("ins_memories_view_note")}: ${item.title}`}
    >
      {imageVisible && item.imageUrl && (
        <img
          src={item.imageUrl}
          alt=""
          className="aspect-[16/9] w-full object-cover"
          onError={() => setImageVisible(false)}
        />
      )}
      <div className="flex flex-1 flex-col items-start p-4">
        <Badge variant="outline" className="mb-3 rounded-sm border-border/10 bg-transparent font-mono text-[10px] text-muted-foreground">
          {memoryMilestoneLabel(item, t)}
        </Badge>
        <h3 className="mb-2 font-serif text-lg font-semibold leading-snug text-foreground">
          {item.title || t("ins_untitled")}
        </h3>
        <p className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">
          {item.excerpt}
        </p>
        <span className="mt-4 text-xs text-foreground/70 group-hover:text-foreground">
          {t("ins_memories_view_note")}
        </span>
      </div>
    </button>
  );
}

function MemoriesSection() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const memoriesQuery = useCachedResource<MemoryItem[]>(
    qk.insights("memories"),
    async () => (await insightsApi.memories()).data,
    { staleTime: STALE.HOUR },
  );
  const memories = memoriesQuery.data;
  const showingDemo = import.meta.env.DEV && !memoriesQuery.loading && !memories?.length;
  const displayedMemories = memories?.length ? memories : showingDemo ? MOCK_MEMORIES : [];

  return (
    <section className="mb-8 border-b border-border/10 pb-8" aria-labelledby="ins-memories-title">
      <div className="mb-4">
        <h2 id="ins-memories-title" className="font-serif text-2xl text-foreground">
          {t("ins_memories_title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("ins_memories_subtitle")}</p>
      </div>
      {memoriesQuery.loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((item) => <Skeleton key={item} className="h-40 w-full rounded-xl" />)}
        </div>
      ) : memoriesQuery.error ? (
        showingDemo ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {displayedMemories.map((item) => (
              <MemoryCard key={item.noteId} item={item} onOpen={() => undefined} isDemo />
            ))}
          </div>
        ) : (
          <p className="rounded-xl border border-border/10 bg-accent/30 px-4 py-5 text-sm text-muted-foreground">
            {t("ins_memories_error")}
          </p>
        )
      ) : displayedMemories.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {displayedMemories.map((item) => (
            <MemoryCard
              key={item.noteId}
              item={item}
              onOpen={() => navigate(`/notes/${item.noteId}`)}
              isDemo={showingDemo}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border border-border/10 bg-accent/30 px-4 py-5 text-sm leading-relaxed text-muted-foreground">
          {t("ins_memories_empty")}
        </p>
      )}
      {showingDemo && (
        <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">
          {t("ins_memories_demo")}
        </p>
      )}
    </section>
  );
}

/* ── Componente Principal ─────────────────────────────────────────────── */

export default function Insights() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const insightsQuery = useCachedResource<{
    hotNotes: NoteInsight[];
    forgottenNotes: NoteInsight[];
    hotEntities: EntityInsight[];
    forgottenEntities: EntityInsight[];
  }>(
    qk.insights("all", 12),
    async () => {
      const [hn, fn, he, fe] = await Promise.all([
        insightsApi.hotNotes(12),
        insightsApi.forgottenNotes(12),
        insightsApi.hotEntities(12),
        insightsApi.forgottenEntities(12),
      ]);
      return {
        hotNotes: hn.data || [],
        forgottenNotes: fn.data || [],
        hotEntities: he.data || [],
        forgottenEntities: fe.data || [],
      };
    },
    { staleTime: STALE.insights }
  );

  const loading = insightsQuery.loading;
  const refreshing = insightsQuery.refreshing;
  const hotNotes = insightsQuery.data?.hotNotes ?? EMPTY_NOTE_INSIGHTS;
  const forgottenNotes = insightsQuery.data?.forgottenNotes ?? EMPTY_NOTE_INSIGHTS;
  const hotEntities = insightsQuery.data?.hotEntities ?? EMPTY_ENTITY_INSIGHTS;
  const forgottenEntities = insightsQuery.data?.forgottenEntities ?? EMPTY_ENTITY_INSIGHTS;
  
  const [view, setView] = useState<View>("all");
  const [search, setSearch] = useState("");
  const load = async (_silent = false) => {
    await insightsQuery.refetch();
  };

  const insights = useMemo(() => {
    const items: InsightItem[] = [];

    hotNotes.forEach((item) => {
      items.push({
        id: item.note.id,
        kind: "note",
        category: "hotNotes",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.note.title || t("ins_untitled"),
        subtitle: t("ins_note"),
        metaDetails: { mentions: item.mentionCount, links: item.entityConnections, hours: item.hoursTracked, daysAgo: item.daysSinceLastInteraction },
        onOpen: () => navigate(`/notes/${item.note.id}`),
      });
    });

    hotEntities.forEach((item) => {
      items.push({
        id: item.entity.id,
        kind: "entity",
        category: "hotEntities",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.entity.title || t("ins_untitled"),
        subtitle: item.entity.type || t("ins_atom"),
        metaDetails: { mentions: item.mentionCount, links: item.relationsCount, hours: item.hoursTracked, daysAgo: item.daysSinceLastMention },
        onOpen: () => navigate(`/entities/${item.entity.id}`),
      });
    });

    forgottenNotes.forEach((item) => {
      items.push({
        id: item.note.id,
        kind: "note",
        category: "worthRevisiting",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.note.title || t("ins_untitled"),
        subtitle: t("ins_note"),
        metaDetails: { mentions: item.mentionCount, links: item.entityConnections, hours: item.hoursTracked, daysAgo: item.daysSinceLastInteraction },
        onOpen: () => navigate(`/notes/${item.note.id}`),
      });
    });

    forgottenEntities.forEach((item) => {
      items.push({
        id: item.entity.id,
        kind: "entity",
        category: "forgottenGems",
        score: item.score,
        normalizedScore: item.score,
        badge: item.badge,
        title: item.entity.title || t("ins_untitled"),
        subtitle: item.entity.type || t("ins_atom"),
        metaDetails: { mentions: item.mentionCount, links: item.relationsCount, hours: item.hoursTracked, daysAgo: item.daysSinceLastMention },
        onOpen: () => navigate(`/entities/${item.entity.id}`),
      });
    });

    // Normalize within each category before mixing them in the "All" tab —
    // notes and entities use different weight scales on the backend, so raw
    // scores aren't comparable across categories. Min-max is monotonic inside
    // each group, so individual tabs keep their existing order.
    const byCategory = new Map<InsightCategory, InsightItem[]>();
    items.forEach((item) => {
      const arr = byCategory.get(item.category) ?? [];
      arr.push(item);
      byCategory.set(item.category, arr);
    });
    byCategory.forEach((group) => {
      const scores = group.map((i) => i.score);
      const min = Math.min(...scores);
      const max = Math.max(...scores);
      const range = max - min || 1;
      group.forEach((item) => {
        item.normalizedScore = (item.score - min) / range;
      });
    });

    return items.sort((a, b) => b.normalizedScore - a.normalizedScore);
  }, [hotNotes, hotEntities, forgottenNotes, forgottenEntities, navigate, t]);

  const filteredInsights = useMemo(() => {
    const query = search.trim().toLowerCase();
    return insights.filter((item) => {
      if (view !== "all" && item.category !== view) return false;
      if (!query) return true;
      return `${item.title} ${item.subtitle} ${item.badge}`.toLowerCase().includes(query);
    });
  }, [insights, search, view]);

  const counts = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matchesSearch = (item: InsightItem) => {
      if (!query) return true;
      return `${item.title} ${item.subtitle} ${item.badge}`.toLowerCase().includes(query);
    };
    const searchFiltered = query ? insights.filter(matchesSearch) : insights;

    return {
      all: searchFiltered.length,
      hotNotes: searchFiltered.filter((item) => item.category === "hotNotes").length,
      hotEntities: searchFiltered.filter((item) => item.category === "hotEntities").length,
      worthRevisiting: searchFiltered.filter((item) => item.category === "worthRevisiting").length,
      forgottenGems: searchFiltered.filter((item) => item.category === "forgottenGems").length,
    };
  }, [insights, search]);

  const SidebarContent = (
    <div className="space-y-7">
      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("ins_index")}</p>
        <NavItem label={t("ins_all_insights")} count={counts.all} active={view === "all"} onClick={() => setView("all")} />
      </div>
      <div>
        <p className="mb-3 text-[10px] uppercase tracking-[0.32em] text-muted-foreground">{t("ins_signals")}</p>
        <div className="space-y-0.5">
          {categoryOrder.map((cat) => (
            <NavItem
              key={cat}
              label={t(CATEGORY_META[cat].labelKey)}
              count={counts[cat]}
              active={view === cat}
              onClick={() => setView(cat)}
            />
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <AppLayout>
      <div className="relative min-h-full">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 px-6 pb-5 pt-[14px] lg:flex-row lg:gap-16 lg:px-12 lg:py-16">
          <aside className="hidden lg:sticky lg:top-16 lg:block lg:w-52 lg:shrink-0 lg:self-start">
            {SidebarContent}
          </aside>
          <main className="min-w-0 flex-1">
            {/* Evolução do score */}
            <div className="-mx-6 mb-6 sm:-mx-2 lg:-mx-4 lg:mb-8">
              <ScoreEvolutionSection />
            </div>

            <MemoriesSection />

            {/* Mobile: search + category chips */}
            <div className="mb-5 space-y-3 lg:hidden">
              <div className="flex items-center gap-2">
                <div className="relative z-0 flex-1">
                  <MagnifyingGlassIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={t("ins_searchAmong", { n: counts.all }) || `Search among ${counts.all} signals…`}
                    className="h-12 w-full rounded-2xl bg-accent pl-11 text-[15px] placeholder:italic placeholder:text-muted-foreground"
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-12 w-12 shrink-0 rounded-2xl bg-accent"
                  onClick={() => load(true)}
                  disabled={refreshing}
                  aria-label={t("ins_refresh")}
                >
                  <ArrowPathIcon className={cn("h-4 w-4", refreshing && "animate-spin")} />
                </Button>
              </div>
              <FilterChips
                value={view}
                onChange={(v) => setView(v as View)}
                options={[
                  { value: "all", label: t("ins_all_insights") },
                  ...categoryOrder.map((cat) => ({ value: cat, label: t(CATEGORY_META[cat].labelKey) })),
                ]}
              />
            </div>

            {/* Input de Busca Sticky (desktop) */}
            <div className="sticky top-14 z-10 -mx-4 hidden border-b border-border/10 bg-background/70 px-4 py-3 backdrop-blur-xl lg:block">
              <div className="relative">
                <MagnifyingGlassIcon className="pointer-events-none absolute left-0 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("ins_search_placeholder")}
                  className="w-full border-0 bg-transparent pl-6 text-sm text-foreground placeholder:italic placeholder:text-muted-foreground focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                />
              </div>
            </div>

            <div className="flex items-center justify-between border-b border-border/5 pb-3 pt-4 mb-4 text-[11px] text-muted-foreground">
              <div>
                {filteredInsights.length === 1
                  ? t("ins_showing_signal", { count: filteredInsights.length })
                  : t("ins_showing_signals", { count: filteredInsights.length })}
              </div>
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {t("ins_sorted_by_score")}
              </div>
            </div>

            <div className="mt-2">
              {loading ? (
                <div className="space-y-3 py-6">
                  {Array.from({ length: 7 }).map((_, index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : filteredInsights.length === 0 ? (
                <div className="py-24 text-center">
                  <p className="font-serif text-2xl italic text-muted-foreground">
                    {t("ins_no_matching")}
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border/10">
                  {filteredInsights.map((item) => (
                    <InsightRow key={`${item.kind}-${item.id}-${item.category}`} item={item} />
                  ))}
                </ul>
              )}
            </div>
          </main>
        </div>
      </div>
    </AppLayout>
  );
}