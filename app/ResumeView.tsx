import type { Owner, Position } from "@/lib/data";
import styles from "./page.module.css";

function formatEnd(end: string): string {
  return end === "present" ? "Present" : end;
}

function formatDates(position: Position): string {
  return `${position.start} — ${formatEnd(position.end)}`;
}

/**
 * Presentational resume: Owner header plus Positions and their Bullets, in
 * whatever order the caller supplies. Shared by the home page (Default Resume)
 * and the result page (Tailored Resume).
 */
export default function ResumeView({ owner, positions }: { owner: Owner; positions: Position[] }) {
  return (
    <>
      <header>
        <h1 className={styles.name}>{owner.name}</h1>
        <p className={styles.headline}>{owner.headline}</p>
        <div className={styles.contact}>
          <span>{owner.contact.email}</span>
          <span>{owner.contact.location}</span>
          {owner.contact.links.map((link) => (
            <a key={link} href={link}>
              {link.replace(/^https?:\/\//, "")}
            </a>
          ))}
        </div>
      </header>

      <hr className={styles.divider} />

      {positions.map((position) => (
        <section
          key={`${position.company}-${position.start}`}
          className={styles.position}
          aria-label={`${position.title} at ${position.company}`}
        >
          <div className={styles.positionHeader}>
            <h2 className={styles.title}>
              {position.title} <span className={styles.company}>· {position.company}</span>
            </h2>
            <span className={styles.dates}>{formatDates(position)}</span>
          </div>
          <p className={styles.location}>{position.location}</p>
          <ul className={styles.bullets}>
            {position.bullets.map((bullet) => (
              <li key={bullet.id}>{bullet.text}</li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
