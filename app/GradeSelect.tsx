import { GRADES, GRADE_NAMES } from "../lib/types.ts";
import type { Grade } from "../lib/types.ts";

export default function GradeSelect({
  id,
  value,
  onChange,
  label,
}: {
  id: string;
  value: Grade;
  onChange: (g: Grade) => void;
  /** Visually hidden label, for use in rows where a visible one would repeat. */
  label?: string;
}) {
  return (
    <>
      {label && (
        <label htmlFor={id} className="sr-only">
          {label}
        </label>
      )}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Grade)}>
        {GRADES.map((g) => (
          <option key={g} value={g}>
            {GRADE_NAMES[g]}
          </option>
        ))}
      </select>
    </>
  );
}
