interface Props {
  text: string;
  color: 'green' | 'gray' | 'amber';
}

export default function Badge({ text, color }: Props) {
  return <span className={`badge ${color}`}>{text}</span>;
}
