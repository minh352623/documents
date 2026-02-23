import React, { useState } from 'react';
import clsx from 'clsx';
import styles from './styles.module.css';

interface Props {
    content: string;
    label?: string;
}

export default function CopyButton({ content, label = 'Copy Markdown' }: Props) {
    const [isCopied, setIsCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy text: ', err);
            alert('Không thể copy nội dung, vui lòng thử lại!');
        }
    };

    return (
        <button
            className={clsx('button button--primary', styles.copyButton, {
                'button--success': isCopied,
            })}
            onClick={handleCopy}
        >
            {isCopied ? 'Đã Copy! ✅' : label}
        </button>
    );
}
