<script lang="ts">
	export let size: 'small' | 'medium' | 'large' = 'medium';
	export let color: string = 'var(--primary)';
</script>

<div class="spinner {size}" style="--spinner-color: {color}" role="status" aria-label="Loading">
	<div class="spinner-circle"></div>
</div>

<style>
	.spinner {
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.spinner-circle {
		border: 2px solid var(--border);
		border-top: 2px solid var(--spinner-color);
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	.spinner.small .spinner-circle {
		width: 16px;
		height: 16px;
		border-width: 1.5px;
	}

	.spinner.medium .spinner-circle {
		width: 24px;
		height: 24px;
		border-width: 2px;
	}

	.spinner.large .spinner-circle {
		width: 32px;
		height: 32px;
		border-width: 3px;
	}

	@keyframes spin {
		0% { 
			transform: rotate(0deg); 
		}
		100% { 
			transform: rotate(360deg); 
		}
	}

	/* Reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.spinner-circle {
			animation: none;
			border-top-color: var(--spinner-color);
			border-right-color: var(--spinner-color);
		}
	}
</style>