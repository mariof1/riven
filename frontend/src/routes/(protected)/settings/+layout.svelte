<script lang="ts">
    import { page } from "$app/stores";
    import { goto } from "$app/navigation";

    type Tab = {
        key: string;
        label: string;
        href: string;
    };

    const tabs: Tab[] = [
        { key: "general", label: "General", href: "/settings/general" },
        { key: "filesystem", label: "Filesystem", href: "/settings/filesystem" },
        { key: "updaters", label: "Updaters", href: "/settings/updaters" },
        { key: "downloaders", label: "Downloaders", href: "/settings/downloaders" },
        { key: "content", label: "Content", href: "/settings/content" },
        { key: "scraping", label: "Scraping", href: "/settings/scraping" },
        { key: "indexer", label: "Indexer", href: "/settings/indexer" },
        { key: "ranking", label: "Ranking", href: "/settings/ranking" },
        { key: "notifications", label: "Notifications", href: "/settings/notifications" },
        { key: "post_processing", label: "Post-processing", href: "/settings/post_processing" },
        { key: "stream", label: "Streaming", href: "/settings/stream" },
        { key: "database", label: "Database", href: "/settings/database" },
        { key: "logging", label: "Logging", href: "/settings/logging" }
    ];

    const isActive = (tabKey: string) => $page.params.tab === tabKey;

    const onChange = (href: string) => {
        void goto(href);
    };
</script>

<div class="mt-14 h-full w-full p-6 md:p-8 md:px-16">
    <div class="mb-6 flex flex-col gap-3">
        <h1 class="text-2xl font-semibold">Settings</h1>

        <div class="-mx-2 overflow-x-auto">
            <div class="inline-flex gap-2 px-2">
                {#each tabs as tab}
                    <a
                        href={tab.href}
                        class={
                            "rounded-md px-3 py-1.5 text-sm transition-colors " +
                            (isActive(tab.key)
                                ? "bg-muted text-foreground"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
                        }
                        on:click|preventDefault={() => onChange(tab.href)}
                    >
                        {tab.label}
                    </a>
                {/each}
            </div>
        </div>
    </div>

    <slot />
</div>
