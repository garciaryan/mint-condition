import Lookup from "./Lookup.tsx";

export default function Home() {
  return (
    <main className="page">
      <header className="masthead">
        <h1>Mint Condition</h1>
        <p>Price a record from its catalog number and grades, using Discogs marketplace data.</p>
      </header>
      <Lookup />
    </main>
  );
}
