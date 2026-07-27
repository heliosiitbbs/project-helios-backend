import supabase from "../config/Supabase.js";

// Get all news posts
export const getNews = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("campus_news")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error fetching news posts"
      });
    }

    return res.status(200).json({
      success: true,
      news: data
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};

// Create a news post
export const createNews = async (req, res) => {
  const { title, category, subject, photos, writer_name, writer_role, writer_profile_photo } = req.body;

  if (!title || !category || !writer_name) {
    return res.status(400).json({
      success: false,
      message: "Title, category, and writer_name are required"
    });
  }

  try {
    const { data, error } = await supabase
      .from("campus_news")
      .insert([
        {
          title,
          category,
          subject,
          photos: photos || [],
          writer_name,
          writer_role: writer_role || "IIT News Team",
          writer_profile_photo
        }
      ])
      .select()
      .single();

    if (error) {
      console.error(error);
      return res.status(500).json({
        success: false,
        message: "Error creating news post"
      });
    }

    return res.status(201).json({
      success: true,
      message: "News post created successfully",
      post: data
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server Error"
    });
  }
};
