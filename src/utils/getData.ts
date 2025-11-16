import pgClient from "../database/pgClient.js";

interface DatabaseResult {
  data?: any[];
  error?: string;
  message?: string;
  total_found?: number;
}

const cleanSqlQuery = (query: string): string => {
  return query
    .replace(/^```[\w]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
};

const getData = async (query: string): Promise<DatabaseResult> => {
    const client = pgClient();
    await client.connect();
  
    try {
      const cleanedQuery = cleanSqlQuery(query);
      console.log("Executing query:", cleanedQuery);
      
      if (cleanedQuery.includes("?")) {
        return { 
          error: "SQL queries must use actual values, not placeholders. Replace ? with actual numbers or strings." 
        };
      }
      
      const result = await client.query(cleanedQuery);
      const rows = result.rows || [];
      
      if (rows.length === 0) {
        return { message: "No restaurants found. Try adjusting the search area or check if coordinates are correct." };
      }

      // Return full rows so AI can see all selected columns (store, services, prices, etc.)
      const data: any[] = rows.map((row: any) => ({ ...row }));
      
      if (data.length > 10) {
        return {
          data: data.slice(0, 10),
          total_found: data.length,
          message: `Found ${data.length} restaurants. Showing first 10.`
        };
      }
      
      return { data };
    } catch (error: any) {
      return { 
        error: `Database error: ${error.message}. Make sure SQL syntax is correct and uses actual values.` 
      };
    } finally {
      await client.end();
    }
  };

export default getData;