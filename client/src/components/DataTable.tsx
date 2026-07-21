import { ReactNode } from 'react';
import styles from './DataTable.module.css';

export interface Column<T> {
  key: string;
  title: string;
  render?: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  empty?: string;
}

/** 通用数据表格 */
export default function DataTable<T>({ columns, rows, rowKey, empty }: Props<T>) {
  if (!rows.length) return <p className="muted">{empty ?? '暂无数据'}</p>;
  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.render ? c.render(row) : String((row as any)[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
