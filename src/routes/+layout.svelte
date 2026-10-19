<script lang="ts">
	import '../app.css';
	let { children } = $props();
</script>

<div class="min-h-screen bg-[#08060B] text-[#DDEBFB] flex flex-col font-sans">
	<main class="flex-1 flex flex-col bg-[#08060B]">
		{@render children()}
	</main>
</div>
