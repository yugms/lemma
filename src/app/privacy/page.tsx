import Link from "next/link";
import type { Metadata } from "next";
import { Facts, LEGAL_CONTACT, LegalPage, Section } from "@/components/legal/legal-page";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What lemma stores, who it is sent to, how long it is kept, and how to delete it.",
};

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Privacy"
      title="What lemma knows about you."
      summary={
        <>
          You can use lemma without an account, and without giving a name or an email.
          What is stored is the practice itself — the problems you were given and how
          you answered them — so that scores, stats and the review queue can be worked
          out from it. Problems and answers are sent to Google&apos;s Gemini models to
          be written, checked and marked. Nothing is sold, and there is no advertising
          or third-party tracking of any kind. You can delete all of it at any time
          from{" "}
          <Link href="/account" className="link">
            your account page
          </Link>
          .
        </>
      }
    >
      <Section id="collected" heading="What is stored">
        <Facts
          items={[
            {
              term: "If you use lemma as a guest",
              detail:
                "An anonymous account with a random id, and nothing else identifying you. There is no name and no email address. The id lives in a cookie in your browser — which is also why clearing your cookies orphans that work permanently, with no way to recover it from another device.",
            },
            {
              term: "If you sign in with Google",
              detail:
                "Your name and email address, as supplied by Google, plus the fact that the account is linked to that Google identity. lemma never sees or stores your Google password. If you were working as a guest first, the existing account is upgraded in place, so the practice you already have is kept.",
            },
            {
              term: "Your practice",
              detail:
                "The sets you generate and their settings; every answer you submit, whether it was right, how long you took, and which mode you were in; study sessions you start and stop; and a cached summary of your statistics used to suggest what to work on next.",
            },
            {
              term: "Worksheets you photograph",
              detail:
                "The image files themselves, along with what the model read from them and the marks it gave. Covered in its own section below, because it is the most sensitive thing here.",
            },
            {
              term: "Study material you upload",
              detail:
                "Not the file. A worksheet, PDF or pasted text you upload to generate practice from is read once and then deleted — what is kept is the description worked out from it: what topics it covers, how hard it is, and what kinds of task are in it, plus any note you typed about what you wanted. Covered in its own section below.",
            },
            {
              term: "Ordinary server logs",
              detail:
                "The hosting provider records requests, including IP addresses, as part of running the service. These are not linked to your practice record and are not used to build any profile of you.",
            },
            {
              term: "Abuse counters",
              detail:
                "When you generate a set or scan a worksheet, a scrambled one-way fingerprint of your network address is recorded with a timestamp, so that no single network can exhaust the shared model quota for everyone else. The address itself is never written down and the fingerprint cannot be turned back into one. These rows are not linked to your account and carry nothing about what you were working on. They are kept for a day and then deleted.",
            },
            {
              term: "That you confirmed your age",
              detail:
                "The date you confirmed you meet the minimum age, described in its own section below. No date of birth is asked for or stored.",
            },
          ]}
        />
      </Section>

      <Section id="scans" heading="Photographs of your work">
        <p>
          Scanning is the one feature that uploads something you did not type, and a
          photo of a worksheet often carries more than the maths: a name at the top of
          the page, a school header, a date, sometimes another student&apos;s
          handwriting. It is worth knowing exactly what happens to it.
        </p>
        <p>
          The image goes from your device into a private storage bucket, filed under
          your account id. It is not public, it is not indexed, and no URL to it is
          shareable. It is then sent to Google&apos;s Gemini model, which transcribes
          the handwriting and judges the maths; the transcription and the marks are
          stored against your account so the results survive a page reload.
        </p>
        <p>
          Two practical consequences. Photograph only the work — cropping out a name
          costs you nothing and means it is never uploaded at all. And if you delete
          your data, the image files are removed from storage as well as the database
          records, in that order, deliberately: doing it the other way round would
          leave files behind that nothing points at any more.
        </p>
        <p>
          Uploading study material works differently, and the difference is deliberate
          — see the next section.
        </p>
      </Section>

      <Section id="materials" heading="Study material you upload">
        <p>
          Generating practice from your own material uploads a file too, and the same
          warning applies about what a photographed page carries beyond the maths. What
          is different is what survives.
        </p>
        <p>
          The file goes into a private storage bucket filed under your account id, is
          sent once to Google&apos;s Gemini model to be described, and is then{" "}
          <em>deleted</em> — including when the reading fails, and whether or not you go
          on to generate anything. Nothing in lemma keeps your worksheet, your chapter
          or your notes.
        </p>
        <p>
          What is kept is what came back: a short title and summary, which topics it
          covers, roughly how hard it is, the kinds of task in it, and the note you
          typed about what you wanted next. That description is what problems are
          written from, which is why more sets can be built from the same material
          without uploading it again. Deleting all your data removes it.
        </p>
        <p>
          Problems written from your material are marked so that they are never served
          to anyone else, unlike problems from an ordinary build, which go into a shared
          pool.
        </p>
      </Section>

      <Section id="ai" heading="What is sent to Google">
        <p>
          lemma uses Google&apos;s Gemini models through Google AI Studio for five
          things: writing problems, independently re-solving them to check the answer,
          judging whether an answer you typed means the same as the stored one, reading
          photographed worksheets, and reading study material you upload.
        </p>
        <p>
          That means the following leaves lemma and reaches Google: the topic and
          settings you asked for, the text of problems, answers you submit when local
          comparison cannot settle them, any worksheet image you upload, and any study
          material you upload along with the note you typed about it. Your name, your
          email address and your account id are <em>not</em> sent — the model is given
          the maths, not the student.
        </p>
        <p>
          Google&apos;s handling of that data is governed by its own terms, not by this
          policy. Note in particular that content sent through the free tier of Google
          AI Studio may be reviewed by Google and used to improve its models. If that
          matters to you, the practical advice is not to photograph pages carrying
          personal details, and not to type anything into an answer box you would not
          want read.
        </p>
      </Section>

      <Section id="processors" heading="Who else handles it">
        <Facts
          items={[
            {
              term: "Supabase",
              detail:
                "The database, the sign-in system and the file storage. Data is held on servers in the United States (region us-east-1).",
            },
            {
              term: "Vercel",
              detail: "Hosting and server logs for the site itself.",
            },
            {
              term: "Google",
              detail:
                "The Gemini models described above, and — only if you choose it — Google sign-in.",
            },
            {
              term: "Cloudflare",
              detail:
                "An anti-abuse check (Turnstile) that runs once, at the moment your guest session is first created, and never again. It exists because anyone can create guest accounts here without an email address, and without it a script could create them in bulk and exhaust the shared model quota for everyone. Cloudflare sees your IP address and some technical signals from your browser for that check. It does not track you across sites and is not used for advertising.",
            },
          ]}
        />
        <p>
          That is the complete list. There is no analytics provider, no advertising
          network, no session recording, and no data broker. Nothing about you is sold
          or shared for marketing.
        </p>
      </Section>

      <Section id="cookies" heading="Cookies">
        <p>
          lemma sets one kind of cookie: the session cookie that keeps you signed in,
          including as a guest. It is strictly necessary — without it the site cannot
          tell which sets are yours — so there is no consent banner to click, because
          there is nothing optional to consent to.
        </p>
        <p>
          Two other things are kept in your browser&apos;s local storage rather than in a
          cookie, and neither is sent to the server: your light or dark theme preference,
          and a note that you have already confirmed your age, which is what stops that
          question being asked again every visit.
        </p>
        <p>
          The one exception is Cloudflare&apos;s anti-abuse check described above, which
          may set a short-lived cookie of its own while it runs. That happens once, when
          a guest session is first created, and it is not something lemma reads.
        </p>
      </Section>

      <Section id="retention" heading="How long it is kept, and how to delete it">
        <p>
          Practice data is kept until you remove it, because that is the point of it:
          your stats and review queue are recalculated from your history every time,
          and there is no separate score to fall back on if the history goes.
        </p>
        <p>
          <Link href="/account" className="link">
            Your account page
          </Link>{" "}
          offers three levels, and they are genuinely different:
        </p>
        <Facts
          items={[
            {
              term: "Clear practice history",
              detail:
                "Removes every answer, study session, cached suggestion and uploaded scan. Keeps the sets themselves, so you can work through them again from scratch.",
            },
            {
              term: "Delete all my data",
              detail:
                "The above, plus the sets and everything worked out from study material you uploaded. The account itself survives.",
            },
            {
              term: "Delete my account",
              detail:
                "Removes the account and everything attached to it, and signs you out. Stored files are swept from the bucket first, then the database records are cascaded away.",
            },
          ]}
        />
        <p>
          All three are immediate and permanent — there is no recovery window and no
          backup we can restore you from. If you would rather ask than click, write to{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>
          .
        </p>
      </Section>

      <Section id="rights" heading="Your rights">
        <p>
          Depending on where you live you may have rights to see, correct, export or
          erase the personal data an organisation holds about you — the UK and EU
          (GDPR), California (CCPA/CPRA) and several other places all grant versions of
          this. lemma&apos;s answer is the same either way: the deletion controls above
          are available to everyone, immediately, without having to ask.
        </p>
        <p>
          For a copy of what is held, or anything the account page does not cover, email{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>
          . lemma is run by one person, so please allow a little time for a reply.
        </p>
      </Section>

      <Section id="age" heading="Age">
        <p>
          lemma is for students aged 13 and over — 16 and over in the European
          Economic Area and the United Kingdom, where that is the threshold for
          consenting to this kind of processing on your own.
        </p>
        <p>
          You are asked to confirm this once, before an account is created, whether you
          continue as a guest or sign in with Google. Declining creates nothing. What is
          kept is the fact that you confirmed and when — not a date of birth, which is
          not asked for and not stored. This is a declaration rather than a verification:
          checking it properly would mean collecting documents or a parent&apos;s contact
          details from every student, which is far more information about children than
          the rule is trying to protect.
        </p>
        <p>
          lemma is not directed at children under those ages and does not knowingly
          collect anything from them. If you are a parent or guardian and believe a child
          has used lemma, email{" "}
          <a href={`mailto:${LEGAL_CONTACT}`} className="link">
            {LEGAL_CONTACT}
          </a>{" "}
          and the account and everything on it will be deleted.
        </p>
      </Section>

      <Section id="security" heading="Security">
        <p>
          Every table holding your work is protected by row-level security, so one
          account cannot read another&apos;s. Worksheet images sit in a private bucket
          keyed to your account id. Answer keys are held in a table the browser has no
          read access to at all — they are released only through a server route that
          first proves the problem belongs to a set you own.
        </p>
        <p>
          No system is perfect, and this one is run by an individual rather than a
          company with a security team. Please do not put anything into lemma that you
          would be seriously harmed by losing or exposing.
        </p>
      </Section>

      <Section id="changes" heading="Changes to this policy">
        <p>
          If this policy changes materially, the date at the top changes with it. There
          is no mailing list to notify, so the date is the signal — it is edited by
          hand, and never set to today automatically, precisely so that it means
          something.
        </p>
      </Section>
    </LegalPage>
  );
}
