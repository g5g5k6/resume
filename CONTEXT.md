# Resume Generator

A web app where an HR user types keywords and receives a resume tailored to their
needs, built from the owner's real experience data. The engine selects real,
pre-written experience, chooses which facts surface, and lets an LLM tune the
phrasing — it never authors facts.

## Language

**Owner**:
The single person the resume is about; the one who enters and maintains the
experience data. There is exactly one Owner.
_Avoid_: User (ambiguous), candidate, author

**HR User**:
A visitor who requests a tailored resume by supplying keywords. Consumes; never
edits the data.
_Avoid_: User (ambiguous), recruiter, viewer

**Position**:
A container for a span of the Owner's experience — company, title, dates, location.
Holds many Bullets. Not itself tailored; it appears if any of its Bullets are selected.
_Avoid_: Job, role, entry

**Bullet**:
The rankable unit of experience — a single accomplishment the Owner authors as a set of
Fragments. Selection operates at the Bullet level: the selector ranks the Bullet's
concatenated Fragment prose, carries no manual tags, and nothing about the Bullet's
internal structure reaches selection. At render time a Bullet is composed from a
keyword-relevant subset of its Fragments.
_Avoid_: Point, line, entry, item

**Fragment**:
The render-time unit inside a Bullet: an independently-omittable true statement about the
accomplishment. Defining property — omitting it can never make any retained Fragment
misleading, so a bounding qualifier ("for an internal tool", "as an intern") is never its
own Fragment; it stays welded into the Fragment it bounds. Honesty is a property of how
the Owner cuts the Fragments, not a rule the composer enforces: because every Fragment is
safe-to-omit by construction, the composer may freely surface, omit, or reorder them.
Owner-authored; never reaches selection.
_Avoid_: Dimension, field, tag, attribute

**Core Fragment**:
The single Fragment carrying a Bullet's verb and spine. Exactly one per Bullet, always
rendered, never offered as a choice — it is what makes the Bullet a sentence.
_Avoid_: Main fragment, primary, head, base

**Additive Fragment**:
Any Fragment that is not the Core. Freely omittable by construction (see Fragment), so
which Additives appear is the Keyword-driven lever on *content*.
_Avoid_: Optional fragment, extra, modifier, detail

**Surfaced**:
Chosen to appear in a Tailored Resume. A Bullet's surfaced Fragments are its Core plus
the Keyword-relevant Additives; the surfaced subset — never the whole Bullet — is what
gets rephrased and what the fidelity check measures against, so an unsurfaced Fragment
cannot reappear in the output.
_Avoid_: Selected (means Bullets), included, visible, rendered

**Keywords**:
The free-form text an HR User supplies to describe the role they're hiring for. The
sole tailoring input; drives which Bullets are selected, which of their Fragments
surface, and how the result is phrased.
_Avoid_: Query, search terms, filters

**Tailored Resume**:
The output produced for one HR request: the Bullets the selector chose, grouped by
Position (reverse-chronological), Bullets relevance-ordered within each Position, each
composed from a Keyword-relevant subset of its Fragments and phrased toward the Keywords.
Positions with no selected Bullets are omitted.
_Avoid_: CV, generated resume, output

**Default Resume**:
The resume returned when the Keywords clear no relevance floor: a curated set of the
Owner's strongest general Bullets, not keyword-tailored. Bullets are marked by the
Owner as belonging to this set.
_Avoid_: Fallback, generic resume, base resume
