export function ImportDatePreview({ dates }: { dates: {
  rowIndex: number; original?: string; dateString?: string; error?: string;
}[] }) {
  const errors = dates.filter(date => date.error);
  const visible = errors.length ? errors.slice(0, 20) : dates.slice(0, 5);
  const showOriginal = dates.some(date => date.original !== undefined);
  return <div className="space-y-2" aria-live="polite">
    <p className="text-sm font-medium">Date preview (YYYY-MM-DD)</p>
    {errors.length > 0 && <p className="text-sm text-destructive">
      Fix {errors.length} date error(s) before importing.
    </p>}
    <table className="w-full text-sm">
      <thead><tr><th className="text-left">Row</th>{showOriginal && <th className="text-left">CSV date</th>}
        <th className="text-left">Import date</th></tr></thead>
      <tbody>{visible.map(date => <tr key={date.rowIndex}>
        <td>{date.rowIndex}</td>{showOriginal && <td>{date.original}</td>}
        <td className={date.error ? "text-destructive" : ""}>{date.error ?? date.dateString}</td>
      </tr>)}</tbody>
    </table>
    {dates.length > visible.length && <p className="text-xs text-muted-foreground">
      Showing {visible.length} of {errors.length || dates.length} {errors.length ? "errors" : "dates"}.
    </p>}
  </div>;
}
