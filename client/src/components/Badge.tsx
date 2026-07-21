import styles from './Badge.module.css';

interface Props {
  text: string;
  color: 'green' | 'gray' | 'amber';
}

export default function Badge({ text, color }: Props) {
  return <span className={`${styles.badge} ${styles[color]}`}>{text}</span>;
}
