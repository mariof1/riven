<script lang="ts">
    import { page } from "$app/state";
    import SettingsTabForm from "./SettingsTabForm.svelte";
</script>

<svelte:head>
    <title>Settings - Riven</title>
</svelte:head>

<div class="max-w-5xl">
    {#key page.params.tab}
        <SettingsTabForm />
    {/key}
</div>
