import React from 'react';

type Props = {
	children: React.ReactNode;
	className?: string;
};

export default function Card({ children, className }: Props) {
	return (
		<div className={['rounded-2xl border border-white/10 bg-white/5', className].filter(Boolean).join(' ')}>
			{children}
		</div>
	);
}
