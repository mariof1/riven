<script lang="ts">
    import { goto } from "$app/navigation";
    import { page } from "$app/state";
    import { authClient } from "$lib/auth-client";
    import * as Avatar from "$lib/components/ui/avatar/index.js";
    import { Button } from "$lib/components/ui/button/index.js";
    import { Separator } from "$lib/components/ui/separator/index.js";
    import { cn } from "$lib/utils";
    import CalendarDays from "@lucide/svelte/icons/calendar-days";
    import FileClock from "@lucide/svelte/icons/file-clock";
    import Home from "@lucide/svelte/icons/home";
    import LayoutDashboard from "@lucide/svelte/icons/layout-dashboard";
    import LogOut from "@lucide/svelte/icons/log-out";
    import Mountain from "@lucide/svelte/icons/mountain";
    import Settings from "@lucide/svelte/icons/settings";
    import Search from "@lucide/svelte/icons/search";
    import Library from "@lucide/svelte/icons/library";
    import User from "@lucide/svelte/icons/user";
    import { getContext } from "svelte";
    import Tooltip from "./tooltip.svelte";
    import ThemeSwitcher from "./theme-switcher.svelte";

    const navItems = [
        { href: "/", icon: Home, label: "Home" },
        { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
        { href: "/library", icon: Library, label: "Library" },
        { href: "/explore", icon: Search, label: "Explore" },
        { href: "/calendar", icon: CalendarDays, label: "Calendar" },
        { href: "/auth", icon: User, label: "Profile" },
        { href: "/settings", icon: Settings, label: "Settings" },
        { href: "/logs", icon: FileClock, label: "Logs" }
    ];

    let { user } = $props();

    const SidebarStore: any = getContext("sidebarStore");
    const isMobileStore: any = getContext("ismobilestore");
</script>

<aside
    class="bg-opacity-75 top-0 left-0 z-5 hidden h-screen w-14 flex-col items-center bg-transparent backdrop-blur-sm md:flex">
    <div class="flex h-18 w-full items-center justify-center">
        <div class="text-primary flex items-center justify-center">
            <Mountain class="size-5" />
        </div>
    </div>
    <nav class="mt-4 flex flex-col items-center gap-3.5">
        {#each navItems as item (item.href)}
            <Tooltip>
                {#snippet trigger()}
                    <a
                        data-sveltekit-preload-data={item.label === "Settings" ? "off" : "hover"}
                        href={item.href}
                        class="hover:bg-accent/80 group relative flex h-10 w-10 items-center justify-center rounded-md transition-colors"
                        class:bg-accent={page.url.pathname === item.href}
                        aria-label={item.label}>
                        <item.icon class="size-5" />
                    </a>
                {/snippet}
                {#snippet content()}
                    <p>
                        {item.label}
                    </p>
                {/snippet}
            </Tooltip>
        {/each}
    </nav>

    <div class="mt-auto flex flex-col items-center gap-3.5 pb-4">
        <ThemeSwitcher />
        {#if user}
            <Tooltip>
                {#snippet trigger()}
                    <Avatar.Root class="cursor-pointer">
                        <Avatar.Image
                            src={user.image || "https://i.pravatar.cc/200"}
                            alt={user.name} />
                        <Avatar.Fallback>CN</Avatar.Fallback>
                    </Avatar.Root>
                {/snippet}
                {#snippet content()}
                    <p class="font-medium">
                        {user.name}
                    </p>
                {/snippet}
            </Tooltip>

            <Button
                onclick={async () => {
                    await authClient.signOut({
                        fetchOptions: {
                            onSuccess: () => {
                                goto("/auth/login");
                            }
                        }
                    });
                }}
                variant="ghost"
                size="icon"
                class="size-10 cursor-pointer rounded-md"
                aria-label="Logout">
                <LogOut class="size-5" />
            </Button>
        {:else}
            <Avatar.Root class="cursor-pointer">
                <Avatar.Image src="https://i.pravatar.cc/200" alt="@guest" />
                <Avatar.Fallback>G</Avatar.Fallback>
            </Avatar.Root>
        {/if}
    </div>
</aside>

{#if isMobileStore.isMobile && SidebarStore.isOpen}
    <div class="fixed inset-0 z-40 md:hidden" aria-hidden="true">
        <button
            class="absolute inset-0 bg-black/50"
            aria-label="Close navigation"
            onclick={() => SidebarStore.close()}></button>

        <div
            class="bg-background absolute inset-y-0 left-0 w-[85%] max-w-sm overflow-y-auto border-r p-4 shadow-lg">
            <div class="flex items-center justify-between">
                {#if user}
                    <div class="flex items-center gap-2">
                        <Avatar.Root class="cursor-pointer">
                            <Avatar.Image
                                src={user.image || "https://i.pravatar.cc/200"}
                                alt={user.username} />
                            <Avatar.Fallback>CN</Avatar.Fallback>
                        </Avatar.Root>
                        <p class="font-medium">{user.username}</p>
                    </div>
                {:else}
                    <div class="flex items-center gap-2">
                        <Avatar.Root class="cursor-pointer">
                            <Avatar.Image src="https://i.pravatar.cc/200" alt="@guest" />
                            <Avatar.Fallback>G</Avatar.Fallback>
                        </Avatar.Root>
                        <p class="font-medium">Guest</p>
                    </div>
                {/if}

                <div class="flex items-center gap-2">
                    <ThemeSwitcher />
                    <Button
                        variant="ghost"
                        size="icon"
                        class="size-10 rounded-md"
                        aria-label="Close"
                        onclick={() => SidebarStore.close()}>
                        <span class="text-muted-foreground">✕</span>
                    </Button>
                </div>
            </div>

            {#if user}
                <div class="mt-2">
                    <Button
                        onclick={async () => {
                            await authClient.signOut({
                                fetchOptions: {
                                    onSuccess: () => {
                                        SidebarStore.close();
                                        goto("/auth/login");
                                    }
                                }
                            });
                        }}
                        variant="ghost"
                        class="w-full justify-start"
                        aria-label="Logout">
                        <LogOut class="mr-2 h-5 w-5" />
                        Logout
                    </Button>
                </div>
            {/if}

            <Separator class="my-3" />

            <nav class="mb-8 flex flex-col items-start gap-1">
                {#each navItems as item}
                    <button
                        type="button"
                        onclick={() => {
                            SidebarStore.close();
                            goto(item.href);
                        }}
                        class={
                            "flex w-full items-center gap-2 rounded-md px-4 py-2 text-sm transition-colors " +
                            cn(
                                "hover:bg-accent/80",
                                page.url.pathname === item.href && "bg-accent"
                            )
                        }
                        aria-label={item.label}>
                        <item.icon class="size-5" />
                        <span>{item.label}</span>
                    </button>
                {/each}
            </nav>
        </div>
    </div>
{/if}
