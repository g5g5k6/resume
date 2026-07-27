import { getDefaultResume, loadResumeData, PRESENT, type Position } from "@/lib/data";
import styles from "./page.module.css";

function formatEnd(end: string): string {
  return end === PRESENT ? "Present" : end;
}

function formatDates(position: Position): string {
  return `${position.start} — ${formatEnd(position.end)}`;
}

export default function Home() {
  const data = loadResumeData();
  const positions = getDefaultResume(data);
  const { owner } = data;

  return (
    <main className={styles.page}>
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

      {positions.map((position, i) => (
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
    </main>
  );
}
