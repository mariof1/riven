import React from 'react';

type Props<T> = {
	items: T[];
	height: number;
	itemHeight: number;
	overScan?: number;
	renderItem: (item: T, index: number) => React.ReactNode;
	className?: string;
	onEndReached?: () => void;
};

export default function VirtualList<T>({
	items,
	height,
	itemHeight,
	overScan = 8,
	renderItem,
	className,
	onEndReached
}: Props<T>) {
	const containerRef = React.useRef<HTMLDivElement | null>(null);
	const [scrollTop, setScrollTop] = React.useState(0);

	const totalHeight = items.length * itemHeight;
	const visibleCount = Math.ceil(height / itemHeight);
	const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overScan);
	const endIndex = Math.min(items.length, startIndex + visibleCount + overScan * 2);

	React.useEffect(() => {
		const el = containerRef.current;
		if (!el) return;
		const onScroll = () => {
			setScrollTop(el.scrollTop);
			if (onEndReached) {
				const remaining = totalHeight - (el.scrollTop + el.clientHeight);
				if (remaining < itemHeight * 6) onEndReached();
			}
		};
		onScroll();
		el.addEventListener('scroll', onScroll, { passive: true });
		return () => el.removeEventListener('scroll', onScroll);
	}, [itemHeight, onEndReached, totalHeight]);

	return (
		<div
			ref={containerRef}
			className={['overflow-auto rounded-2xl border border-white/10 bg-white/5', className]
				.filter(Boolean)
				.join(' ')}
			style={{ height }}
		>
			<div className="relative" style={{ height: totalHeight }}>
				{items.slice(startIndex, endIndex).map((item, i) => {
					const index = startIndex + i;
					return (
						<div
							key={index}
							className="absolute left-0 right-0"
							style={{ transform: `translateY(${index * itemHeight}px)` }}
						>
							{renderItem(item, index)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
