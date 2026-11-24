import { getAnnualTemperature } from "@/lib/weather/annualServer";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const parse = (name: string) => params.get(name)?.trim() ? Number(params.get(name)) : NaN;
  const latitude = parse("latitude"), longitude = parse("longitude"), hour = parse("hour");
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
    !Number.isInteger(hour) || hour < 0 || hour > 21 || hour % 3 !== 0) {
    return Response.json({ error: "Enter valid coordinates and a three-hour UTC time." }, { status: 400 });
  }
  try {
    return Response.json(await getAnnualTemperature(latitude, longitude, hour), {
      headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" },
    });
  } catch {
    return Response.json({ error: "Annual temperature data is unavailable. Please try again." }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
