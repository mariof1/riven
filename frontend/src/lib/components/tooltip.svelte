<script lang="ts">
    import type { Snippet } from "svelte";
    import { cn } from "$lib/utils";

    let {
        trigger,
        content,
        class: className = "",
        side = "top",
        sideOffset = 8,
        ...restProps
    }: {
        trigger: Snippet;
        content: Snippet;
        class?: string;
        side?: "top" | "bottom" | "left" | "right";
        sideOffset?: number;
        [key: string]: any;
    } = $props();

    const sideClass = (s: string) => {
        switch (s) {
            case "bottom":
                return "top-full left-1/2 -translate-x-1/2";
            case "left":
                return "right-full top-1/2 -translate-y-1/2";
            case "right":
                return "left-full top-1/2 -translate-y-1/2";
            case "top":
            default:
                return "bottom-full left-1/2 -translate-x-1/2";
        }
    };
</script>

<span class={cn("group relative inline-flex", className)} {...restProps}>
    <span class="inline-flex">{@render trigger()}</span>
    <span
        class={cn(
            "pointer-events-none absolute z-50 hidden whitespace-nowrap rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-md",
            "group-hover:block group-focus-within:block",
            sideClass(side)
        )}
        style={
            side === "top"
                ? `margin-bottom:${sideOffset}px`
                : side === "bottom"
                    ? `margin-top:${sideOffset}px`
                    : side === "left"
                        ? `margin-right:${sideOffset}px`
                        : `margin-left:${sideOffset}px`
        }
        role="tooltip"
    >
        {@render content()}
    </span>
</span>
